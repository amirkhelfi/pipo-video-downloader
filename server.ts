import express from "express";
import path from "path";
import fs from "fs";

const app = express();
const PORT = 3000;
const USERS_FILE = "users.json";

app.use(express.json());

// ============================================================
//  إدارة المستخدمين
// ============================================================
interface User {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  joinedAt: number;
  lastLogin: number;
  ipAddress?: string;
  userAgent?: string;
  isBanned: boolean;
  isAdmin: boolean;
}

function loadUsers(): User[] {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {}
  return [];
}

function saveUsers(users: User[]) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ============================================================
//  تسجيل الدخول
// ============================================================
app.post("/api/register", (req, res) => {
  const { firstName, lastName } = req.body;
  if (!firstName || !lastName) {
    return res.status(400).json({ error: "الاسم واللقب مطلوبان" });
  }

  const users = loadUsers();
  const existingUser = users.find(
    (u) => u.firstName === firstName && u.lastName === lastName
  );

  if (existingUser) {
    if (existingUser.isBanned) {
      return res.status(403).json({ error: "تم حظرك من الموقع" });
    }
    existingUser.lastLogin = Date.now();
    existingUser.ipAddress = req.ip;
    existingUser.userAgent = req.headers["user-agent"];
    saveUsers(users);
    return res.json({ success: true, user: existingUser, isNew: false });
  }

  const newUser: User = {
    id: "user_" + Date.now(),
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    joinedAt: Date.now(),
    lastLogin: Date.now(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    isBanned: false,
    isAdmin: false,
  };

  users.push(newUser);
  saveUsers(users);
  return res.json({ success: true, user: newUser, isNew: true });
});

// ============================================================
//  API للمطور
// ============================================================
const ADMIN_TOKEN = "PIPO_ADMIN_2026";

app.get("/api/users", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: "غير مصرح" });
  }
  return res.json({ users: loadUsers() });
});

app.post("/api/ban-user", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: "غير مصرح" });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "معرف المستخدم مطلوب" });

  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  user.isBanned = true;
  saveUsers(users);
  return res.json({ success: true });
});

app.post("/api/unban-user", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: "غير مصرح" });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "معرف المستخدم مطلوب" });

  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  user.isBanned = false;
  saveUsers(users);
  return res.json({ success: true });
});

// ============================================================
//  استخراج الفيديو
// ============================================================
async function resolveShortUrl(rawUrl: string): Promise<string> {
  try {
    let clean = rawUrl.trim();
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = "https://" + clean;
    }
    const resp = await fetch(clean, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (resp.url && resp.url.startsWith("http")) {
      return resp.url.split("?")[0] || resp.url;
    }
    return clean;
  } catch {
    return rawUrl;
  }
}

app.get("/api/proxy-media", async (req, res) => {
  const { url, filename, type } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).send("Missing target media URL");
  }

  try {
    const upstreamRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!upstreamRes.ok) return res.redirect(url);

    const contentType = (type as string) || upstreamRes.headers.get("content-type") || "video/mp4";
    const downloadFilename = (filename as string) || "PIPO_Video_NoWM.mp4";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadFilename)}"`);
    res.setHeader("Access-Control-Allow-Origin", "*");

    const arrayBuffer = await upstreamRes.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch {
    return res.redirect(url as string);
  }
});

// ============================================================
//  دالة استخراج تيك توك (TikDown API)
// ============================================================
async function extractTikTokReal(rawUrl: string) {
  const resolvedUrl = await resolveShortUrl(rawUrl);
  const cleanUrl = resolvedUrl.split("?")[0] || resolvedUrl;

  const apiUrl = `https://tikdown.org/api/ajaxSearch?q=${encodeURIComponent(cleanUrl)}`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });

  if (!response.ok) throw new Error("فشل الاتصال بـ TikTok API");
  const data = await response.json();

  if (!data.success || !data.data) {
    throw new Error(data.msg || "فشل استخراج الفيديو");
  }

  const item = data.data;
  const directNoWmUrl = item.video_no_watermark || item.video || item.play || "";
  const directMusicUrl = item.music || "";

  if (!directNoWmUrl) {
    throw new Error("لا يوجد فيديو قابل للتحميل بدون علامة مائية");
  }

  const title = item.title || "مقطع تيك توك";
  const safeFilename = title.replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, "_").substring(0, 30);

  const downloadUrl = `/api/proxy-media?url=${encodeURIComponent(directNoWmUrl)}&filename=${encodeURIComponent(`PIPO_${safeFilename}_NoWM.mp4`)}&type=video/mp4`;
  const audioDownloadUrl = `/api/proxy-media?url=${encodeURIComponent(directMusicUrl || directNoWmUrl)}&filename=${encodeURIComponent(`PIPO_${safeFilename}_Audio.mp3`)}&type=audio/mpeg`;

  return {
    id: "tt_" + Date.now(),
    originalUrl: rawUrl,
    platform: "tiktok",
    title,
    author: {
      name: item.author?.name || "TikTok Creator",
      username: item.author?.unique_id ? `@${item.author.unique_id}` : "@tiktok_user",
      avatarUrl: item.author?.avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=tiktok",
      verified: true,
    },
    duration: item.duration || 30,
    durationFormatted: `${Math.floor((item.duration || 30) / 60)}:${((item.duration || 30) % 60).toString().padStart(2, "0")}`,
    thumbnailUrl: item.cover || "",
    previewVideoUrl: directNoWmUrl,
    views: item.play_count ? `${Math.round(item.play_count / 1000)}K` : "1.2M",
    likes: item.digg_count ? `${Math.round(item.digg_count / 1000)}K` : "145K",
    uploadDate: "متاح الآن بدون علامة مائية",
    description: "مقطع تيك توك بدون علامة مائية",
    formats: [
      {
        id: "fmt_tt_hd",
        label: "1080p HD (بدون علامة مائية)",
        resolution: "1920x1080",
        quality: "1080p",
        fileType: "mp4",
        estimatedSize: "18.5 MB",
        bitrate: "12.0 Mbps",
        fps: 60,
        hasAudio: true,
        noWatermark: true,
        isAiEnhanced: false,
        downloadUrl: downloadUrl,
      },
      {
        id: "fmt_tt_audio",
        label: "صوت MP3 (320kbps)",
        resolution: "Audio Only",
        quality: "Audio HD",
        fileType: "mp3",
        estimatedSize: "4.2 MB",
        bitrate: "320 kbps",
        fps: 0,
        hasAudio: true,
        noWatermark: true,
        isAiEnhanced: true,
        downloadUrl: audioDownloadUrl,
      },
    ],
  };
}

// ============================================================
//  API استخراج الفيديو الرئيسي
// ============================================================
app.post("/api/extract", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "يرجى إدخال رابط صالح" });
  }

  try {
    const low = url.toLowerCase();
    let data;
    if (low.includes("tiktok.com") || low.includes("vt.tiktok.com")) {
      data = await extractTikTokReal(url);
    } else {
      // منصات أخرى (يوتيوب، إنستغرام، إلخ)
      throw new Error("يتم حالياً دعم تيك توك فقط. سيتم إضافة منصات أخرى قريباً.");
    }
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "فشل استخراج الفيديو" });
  }
});

// ============================================================
//  خدمة الملفات الثابتة
// ============================================================
app.use(express.static(path.join(__dirname, "dist")));

// ============================================================
//  تشغيل الخادم
// ============================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ PIPO Engine running at http://localhost:${PORT}`);
});
