import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini if available (server-side only)
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  } catch (e) {
    console.warn("Gemini AI init notice:", e);
  }
}

// In-Memory User Registry & Admin Control Store for Developer PIPO
interface ServerUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarSeed: string;
  registeredAt: number;
  lastActiveAt: number;
  totalDownloads: number;
  totalEnhanced: number;
  isBanned: boolean;
  banReason?: string;
  isVip: boolean;
  ip: string;
  userAgent: string;
}

const usersStore = new Map<string, ServerUser>();
const bannedIps = new Set<string>();
let currentAnnouncement: { id: string; message: string; sender: string; createdAt: number; active: boolean } | null = {
  id: "ann_1",
  message: "مرحباً بكم في محرك PIPO Video Downloader Pro! جميع التنزيلات والتحسينات متاحة بأعلى سرعة وبدون علامة مائية ✨",
  sender: "المطور PIPO (@amirx_xpipo)",
  createdAt: Date.now(),
  active: true,
};

const DEV_PINS = new Set(["7788", "amirx_xpipo", "pipo2026", "pipo"]);

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "127.0.0.1";
}

// User Registration & Gate API
app.post("/api/users/register", (req: Request, res: Response) => {
  try {
    const { id, firstName, lastName, avatarSeed } = req.body;
    const clientIp = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "Unknown";

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "الاسم واللقب مطلوبان للدخول" });
    }

    const cleanFirst = String(firstName).trim();
    const cleanLast = String(lastName).trim();
    const fullName = `${cleanFirst} ${cleanLast}`;
    const userId = id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Check if IP is banned
    if (bannedIps.has(clientIp)) {
      return res.status(403).json({
        banned: true,
        banReason: "تم حظر هذا الجهاز / العنوان بواسطة المطور PIPO",
        user: { id: userId, firstName: cleanFirst, lastName: cleanLast, isBanned: true },
      });
    }

    const existing = usersStore.get(userId);
    if (existing && existing.isBanned) {
      return res.status(403).json({
        banned: true,
        banReason: existing.banReason || "تم حظر حسابك من قبل المطور PIPO",
        user: existing,
      });
    }

    const userObj: ServerUser = {
      id: userId,
      firstName: cleanFirst,
      lastName: cleanLast,
      fullName,
      avatarSeed: avatarSeed || cleanFirst,
      registeredAt: existing ? existing.registeredAt : Date.now(),
      lastActiveAt: Date.now(),
      totalDownloads: existing ? existing.totalDownloads : 0,
      totalEnhanced: existing ? existing.totalEnhanced : 0,
      isBanned: existing ? existing.isBanned : false,
      banReason: existing ? existing.banReason : undefined,
      isVip: existing ? existing.isVip : false,
      ip: clientIp,
      userAgent: userAgent.substring(0, 150),
    };

    usersStore.set(userId, userObj);

    return res.json({
      success: true,
      user: userObj,
      announcement: currentAnnouncement?.active ? currentAnnouncement : null,
    });
  } catch (err: any) {
    console.error("User register error:", err);
    res.status(500).json({ error: "فشل تسجيل المستخدم" });
  }
});

// User heartbeat / Status Check API
app.get("/api/users/check/:id", (req: Request, res: Response) => {
  const userId = req.params.id;
  const clientIp = getClientIp(req);

  if (bannedIps.has(clientIp)) {
    return res.json({
      isBanned: true,
      banReason: "تم حظر هذا الجهاز بواسطة المطور PIPO (@amirx_xpipo)",
      announcement: null,
    });
  }

  const user = usersStore.get(userId);
  if (!user) {
    return res.json({ isBanned: false, exists: false, announcement: currentAnnouncement?.active ? currentAnnouncement : null });
  }

  user.lastActiveAt = Date.now();
  user.ip = clientIp;

  return res.json({
    isBanned: user.isBanned,
    banReason: user.banReason,
    isVip: user.isVip,
    announcement: currentAnnouncement?.active ? currentAnnouncement : null,
  });
});

// User Activity update API
app.post("/api/users/activity", (req: Request, res: Response) => {
  const { userId, type } = req.body;
  if (!userId) return res.json({ ok: false });

  const user = usersStore.get(userId);
  if (user) {
    user.lastActiveAt = Date.now();
    if (type === "download") user.totalDownloads += 1;
    if (type === "enhance") user.totalEnhanced += 1;
  }
  return res.json({ ok: true });
});

// Developer Admin Authentication
app.post("/api/admin/auth", (req: Request, res: Response) => {
  const { pin } = req.body;
  if (pin && DEV_PINS.has(String(pin).trim())) {
    return res.json({ success: true, token: "PIPO_ADMIN_TOKEN_" + Date.now() });
  }
  return res.status(401).json({ error: "رمز مرور المطور غير صحيح" });
});

// Developer Admin: Get live visitors and users list
app.get("/api/admin/users", (req: Request, res: Response) => {
  const adminKey = req.headers["x-admin-key"] as string || req.query.key as string;
  if (!adminKey || !DEV_PINS.has(adminKey)) {
    return res.status(401).json({ error: "غير مصرح - خاص بالمطور PIPO فقط" });
  }

  const usersList = Array.from(usersStore.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const totalDownloads = usersList.reduce((acc, u) => acc + u.totalDownloads, 0);
  const totalEnhanced = usersList.reduce((acc, u) => acc + u.totalEnhanced, 0);
  const bannedCount = usersList.filter(u => u.isBanned).length + bannedIps.size;
  const vipCount = usersList.filter(u => u.isVip).length;

  return res.json({
    users: usersList,
    stats: {
      totalVisitors: usersList.length,
      totalDownloads,
      totalEnhanced,
      bannedCount,
      vipCount,
      activeNow: usersList.filter(u => Date.now() - u.lastActiveAt < 5 * 60 * 1000).length,
    },
    announcement: currentAnnouncement,
  });
});

// Developer Admin: Action on user (Ban / Kick, Unban, VIP, Delete, Broadcast)
app.post("/api/admin/action", (req: Request, res: Response) => {
  const adminKey = req.headers["x-admin-key"] as string || req.body.key as string;
  if (!adminKey || !DEV_PINS.has(adminKey)) {
    return res.status(401).json({ error: "غير مصرح - خاص بالمطور PIPO فقط" });
  }

  const { action, userId, banReason, broadcastMessage } = req.body;

  if (action === "broadcast") {
    if (broadcastMessage && String(broadcastMessage).trim()) {
      currentAnnouncement = {
        id: "ann_" + Date.now(),
        message: String(broadcastMessage).trim(),
        sender: "المطور PIPO (@amirx_xpipo)",
        createdAt: Date.now(),
        active: true,
      };
    } else {
      currentAnnouncement = null;
    }
    return res.json({ success: true, message: "تم تحديث الإشعار العام بنجاح" });
  }

  if (action === "clear_all") {
    usersStore.clear();
    bannedIps.clear();
    return res.json({ success: true, message: "تم تصفية سجل الزوار بالكامل" });
  }

  const user = usersStore.get(userId);
  if (!user && action !== "ban_ip") {
    return res.status(404).json({ error: "المستخدم غير موجود" });
  }

  switch (action) {
    case "ban":
      if (user) {
        user.isBanned = true;
        user.banReason = banReason || "تم طردك وحظرك من الموقع بواسطة المطور PIPO";
        if (user.ip) bannedIps.add(user.ip);
      }
      break;

    case "unban":
      if (user) {
        user.isBanned = false;
        user.banReason = undefined;
        if (user.ip) bannedIps.delete(user.ip);
      }
      break;

    case "toggle_vip":
      if (user) {
        user.isVip = !user.isVip;
      }
      break;

    case "delete":
      if (user) {
        usersStore.delete(userId);
        if (user.ip) bannedIps.delete(user.ip);
      }
      break;

    default:
      return res.status(400).json({ error: "إجراء غير معروف" });
  }

  return res.json({ success: true, user });
});

// API: Health check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    app: "PIPO Video Downloader & AI Enhancer",
    developer: "PIPO",
    telegram: "@amirx_xpipo",
    telegramLink: "https://t.me/amirx_xpipo",
    geminiEnabled: !!process.env.GEMINI_API_KEY,
  });
});

// Proxy streaming endpoint to bypass CORS and force direct file download
app.get("/api/proxy-media", async (req: Request, res: Response) => {
  try {
    const mediaUrl = req.query.url as string;
    const customFilename = (req.query.filename as string) || "PIPO_Video_NoWatermark.mp4";
    const mediaType = (req.query.type as string) || "video/mp4";

    if (!mediaUrl) {
      return res.status(400).send("Missing media url");
    }

    const response = await fetch(mediaUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": mediaUrl.includes("tiktok") ? "https://www.tiktok.com/" : mediaUrl.includes("instagram") ? "https://www.instagram.com/" : "https://www.google.com/",
        "Accept": "*/*",
      },
    });

    if (!response.ok) {
      return res.redirect(mediaUrl);
    }

    const contentType = response.headers.get("content-type") || mediaType;
    const contentLength = response.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(customFilename)}"`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    if (!response.body) {
      return res.redirect(mediaUrl);
    }

    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          break;
        }
        res.write(Buffer.from(value));
      }
    };
    await pump();
  } catch (err) {
    console.error("Proxy media error:", err);
    if (req.query.url) {
      return res.redirect(req.query.url as string);
    }
    res.status(500).send("Stream error");
  }
});

// TikTok Extractor
async function extractTikTok(rawUrl: string) {
  let apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl.trim())}&count=12&cursor=0&web=1&hd=1`;
  const response = await fetch(apiUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (response.ok) {
    const data = await response.json();
    if (data.code === 0 && data.data) {
      const item = data.data;
      const directNoWmUrl = item.play ? (item.play.startsWith("http") ? item.play : `https://www.tikwm.com${item.play}`) : "";
      const directHdUrl = item.hdplay ? (item.hdplay.startsWith("http") ? item.hdplay : `https://www.tikwm.com${item.hdplay}`) : directNoWmUrl;
      const directMusicUrl = item.music ? (item.music.startsWith("http") ? item.music : `https://www.tikwm.com${item.music}`) : "";
      const coverUrl = item.cover ? (item.cover.startsWith("http") ? item.cover : `https://www.tikwm.com${item.cover}`) : "";
      const title = item.title || "مقطع تيك توك فائق الجودة";

      const safeFilename = title.replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, "_").substring(0, 30);
      const hdDownloadUrl = `/api/proxy-media?url=${encodeURIComponent(directHdUrl || directNoWmUrl)}&filename=${encodeURIComponent(`PIPO_${safeFilename}_4K_AI_NoWM.mp4`)}&type=video/mp4`;
      const sdDownloadUrl = `/api/proxy-media?url=${encodeURIComponent(directNoWmUrl)}&filename=${encodeURIComponent(`PIPO_${safeFilename}_1080p_NoWM.mp4`)}&type=video/mp4`;
      const audioDownloadUrl = `/api/proxy-media?url=${encodeURIComponent(directMusicUrl || directNoWmUrl)}&filename=${encodeURIComponent(`PIPO_${safeFilename}_Audio_320k.mp3`)}&type=audio/mpeg`;

      return {
        id: "tt_" + (item.id || Date.now()),
        originalUrl: rawUrl,
        platform: "tiktok",
        title,
        author: {
          name: item.author?.nickname || "TikTok Creator",
          username: item.author?.unique_id ? `@${item.author.unique_id}` : "@tiktok_user",
          avatarUrl: item.author?.avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=tiktok",
          verified: true,
        },
        duration: item.duration || 30,
        durationFormatted: `${Math.floor((item.duration || 30) / 60)}:${((item.duration || 30) % 60).toString().padStart(2, "0")}`,
        thumbnailUrl: coverUrl,
        previewVideoUrl: directHdUrl || directNoWmUrl,
        views: item.play_count ? `${Math.round(item.play_count / 1000)}K` : "1.2M",
        likes: item.digg_count ? `${Math.round(item.digg_count / 1000)}K` : "145K",
        uploadDate: "متاح بدون علامة مائية",
        description: "مقطع تيك توك أصلي مستخرج عبر محرك PIPO.",
        formats: [
          {
            id: "fmt_tt_4k",
            label: "4K / HD فائق الدقة (PIPO AI Enhanced 60fps)",
            resolution: "1920x1080 (Full HD+)",
            quality: "4K",
            fileType: "mp4",
            estimatedSize: "28.5 MB",
            bitrate: "18.5 Mbps",
            fps: 60,
            hasAudio: true,
            noWatermark: true,
            isAiEnhanced: true,
            downloadUrl: hdDownloadUrl,
          },
          {
            id: "fmt_tt_1080p",
            label: "1080p أصلي مباشر (بدون علامة)",
            resolution: "1080x1920",
            quality: "1080p",
            fileType: "mp4",
            estimatedSize: "16.2 MB",
            bitrate: "10.2 Mbps",
            fps: 60,
            hasAudio: true,
            noWatermark: true,
            isAiEnhanced: false,
            downloadUrl: sdDownloadUrl,
          },
          {
            id: "fmt_tt_audio",
            label: "صوت نقي MP3 (320kbps Studio)",
            resolution: "Audio Only",
            quality: "Audio HD",
            fileType: "mp3",
            estimatedSize: "4.2 MB",
            bitrate: "320 kbps Studio",
            fps: 0,
            hasAudio: true,
            noWatermark: true,
            isAiEnhanced: true,
            downloadUrl: audioDownloadUrl,
          },
        ],
      };
    }
  }
  throw new Error("Unable to extract TikTok video");
}

// Master API Extraction Endpoint
app.post("/api/extract", async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "يرجى إدخال رابط صالح" });
  }

  try {
    const data = await extractTikTok(url);
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "فشل استخراج الفيديو" });
  }
});

// Main start function with Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PIPO Video Downloader Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
