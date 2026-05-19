const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const fs = require("fs/promises");
const { Server } = require("socket.io");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const dotenv = require("dotenv");
dotenv.config();

let PakasirClient = null;
try {
    // Optional dependency for payment flow; fallback to simulation if not available.
    const { Pakasir } = require("pakasir-sdk");
    PakasirClient = Pakasir;
} catch (error) {
    PakasirClient = null;
}

const PAKASIR_SLUG = process.env.PAKASIR_SLUG || "";
const PAKASIR_API_KEY = process.env.PAKASIR_API_KEY || "";
const PAKASIR_REDIRECT_URL = process.env.PAKASIR_REDIRECT_URL || "";
const PAKASIR_SIMULATE = process.env.PAKASIR_SIMULATE === "true";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback";

const pakasirClient = PakasirClient && PAKASIR_SLUG && PAKASIR_API_KEY
    ? new PakasirClient({ slug: PAKASIR_SLUG, apikey: PAKASIR_API_KEY })
    : null;

const isGoogleOAuthConfigured = () => Boolean(
    GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL
);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const DATA_DIR = path.join(__dirname, "data");
const FILES = {
    users: "users.json",
    campaigns: "campaigns.json",
    donations: "donations.json",
    transactions: "transactions.json"
};

const DEFAULT_CHART_DATA = {
    week: {
        labels: ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"],
        data: [1.2, 2.5, 1.8, 3.2, 4.5, 3.8, 5.2]
    },
    month: {
        labels: ["Minggu 1", "Minggu 2", "Minggu 3", "Minggu 4"],
        data: [12.5, 15.2, 10.8, 20.1]
    },
    year: {
        labels: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"],
        data: [45, 52, 38, 65, 72, 68, 85, 92, 88, 105, 110, 125]
    }
};

const seedData = {
    users: [
        {
            id: "user_admin",
            name: "Admin Pusat",
            email: "admin@crowdfund.local",
            password: "admin123",
            role: "admin",
            createdAt: new Date().toISOString()
        }
    ],
    campaigns: [
        {
            id: "1",
            title: "Bantu Biaya Operasi Jantung Dek Nisa",
            category: "Bantuan Medis",
            targetAmount: 100000000,
            currentAmount: 65000000,
            deadline: "2026-06-30",
            imageUrl: "https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=1000&auto=format&fit=crop",
            story: "Halo Orang Baik, perkenalkan ini Nisa (5 tahun). Sejak lahir, Nisa didiagnosis mengalami kelainan jantung bawaan yang membuatnya mudah sesak napas dan kulitnya membiru jika menangis terlalu lama.\n\nKondisi ekonomi keluarga yang pas-pasan membuat Nisa belum bisa mendapatkan tindakan operasi yang seharusnya dilakukan secepat mungkin. Ayah Nisa hanya seorang buruh harian lepas, sedangkan ibunya mengurus Nisa di rumah.\n\nMari kita bantu Nisa untuk mendapatkan senyum sehatnya kembali. Bantuan sekecil apapun dari teman-teman akan sangat berarti bagi kelangsungan hidup Nisa.",
            organizer: "Yayasan Zakat",
            createdAt: new Date().toISOString()
        },
        {
            id: "2",
            title: "Renovasi SD Pelosok Desa",
            category: "Pendidikan",
            targetAmount: 50000000,
            currentAmount: 21000000,
            deadline: "2026-07-15",
            imageUrl: "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=1000&auto=format&fit=crop",
            story: "Sekolah di pelosok desa membutuhkan renovasi untuk memberikan ruang belajar yang aman dan nyaman. Dengan bantuan Anda, kami akan memperbaiki atap, lantai, dan fasilitas pendukung agar proses belajar mengajar berjalan lebih baik.",
            organizer: "Relawan Pendidikan",
            createdAt: new Date().toISOString()
        }
    ],
    donations: [
        {
            id: "don_1",
            campaignId: "1",
            donorName: "Hamba Allah",
            amount: 500000,
            method: "QRIS",
            createdAt: new Date().toISOString()
        }
    ],
    transactions: []
};

const ensureDataFiles = async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const entries = Object.entries(FILES);
    for (const [key, fileName] of entries) {
        const filePath = path.join(DATA_DIR, fileName);
        try {
            await fs.access(filePath);
        } catch (error) {
            const payload = seedData[key] || [];
            await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
        }
    }
};

const readData = async (key) => {
    const filePath = path.join(DATA_DIR, FILES[key]);
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
};

const writeData = async (key, payload) => {
    const filePath = path.join(DATA_DIR, FILES[key]);
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
};

const makeId = (prefix) => {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const setupGoogleAuth = () => {
    if (!isGoogleOAuthConfigured()) return;

    passport.use(new GoogleStrategy({
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const email = profile.emails?.[0]?.value || "";
            if (!email) {
                return done(new Error("Google account has no email."));
            }

            const users = await readData("users");
            let user = users.find((item) => item.email === email);

            if (!user) {
                user = {
                    id: makeId("user"),
                    name: profile.displayName || email.split("@")[0],
                    email,
                    password: "",
                    role: "user",
                    provider: "google",
                    providerId: profile.id || "",
                    createdAt: new Date().toISOString()
                };
                users.push(user);
                await writeData("users", users);
            }

            return done(null, user);
        } catch (error) {
            return done(error);
        }
    }));
};

setupGoogleAuth();

const normalizeAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePaymentMethod = (method) => {
    const raw = (method || "").toString().trim().toLowerCase();
    const normalized = raw.replace(/\s+/g, "_");
    const map = {
        all: "all",
        qris: "qris",
        paypal: "paypal",
        bni_va: "bni_va",
        bri_va: "bri_va",
        cimb_niaga_va: "cimb_niaga_va",
        maybank_va: "maybank_va",
        permata_va: "permata_va",
        bnc_va: "bnc_va",
        atm_bersama_va: "atm_bersama_va",
        sampoerna_va: "sampoerna_va",
        artha_graha_va: "artha_graha_va",
        gopay: "qris",
        bca_virtual_account: "permata_va",
        bca_va: "permata_va"
    };
    return map[normalized] || "qris";
};

const parseCookies = (req) => {
    const header = req.headers.cookie;
    if (!header) return {};

    return header.split(";").reduce((acc, part) => {
        const [key, ...value] = part.trim().split("=");
        acc[key] = decodeURIComponent(value.join("="));
        return acc;
    }, {});
};

const getAuthUser = async (req) => {
    const cookies = parseCookies(req);
    const userId = req.headers["x-user-id"] || cookies.auth_user;
    if (!userId) return null;

    const users = await readData("users");
    const user = users.find((item) => item.id === userId || item.email === userId);
    if (!user) return null;

    const emailHeader = req.headers["x-user-email"];
    if (emailHeader && user.email !== emailHeader) return null;

    return user;
};

const requireAuth = async (req, res, next) => {
    try {
        const user = await getAuthUser(req);
        if (!user) {
            res.status(401).json({ message: "Silakan login terlebih dahulu." });
            return;
        }
        req.authUser = user;
        next();
    } catch (error) {
        next(error);
    }
};

const requirePageAuth = async (req, res, next) => {
    try {
        const user = await getAuthUser(req);
        if (!user) {
            res.redirect("/login.html");
            return;
        }
        req.authUser = user;
        next();
    } catch (error) {
        next(error);
    }
};

const ensureGoogleOAuth = (req, res, next) => {
    if (!isGoogleOAuthConfigured()) {
        res.status(503).send("Google OAuth belum dikonfigurasi.");
        return;
    }
    next();
};

const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const addDays = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

const toMillions = (amount) => Number((amount / 1000000).toFixed(2));

const sumDonationsInRange = (donations, start, end) => {
    const startTime = start.getTime();
    const endTime = end.getTime();

    return donations.reduce((sum, donation) => {
        const createdAt = new Date(donation.createdAt || donation.created_at || 0);
        const time = createdAt.getTime();
        if (Number.isNaN(time)) return sum;
        if (time >= startTime && time <= endTime) {
            return sum + normalizeAmount(donation.amount);
        }
        return sum;
    }, 0);
};

const buildWeekSeries = (donations) => {
    const today = startOfDay(new Date());
    const labels = [];
    const data = [];

    for (let i = 6; i >= 0; i -= 1) {
        const day = addDays(today, -i);
        const start = startOfDay(day);
        const end = endOfDay(day);
        labels.push(DAY_NAMES[day.getDay()]);
        data.push(toMillions(sumDonationsInRange(donations, start, end)));
    }

    return { labels, data };
};

const buildMonthSeries = (donations) => {
    const today = startOfDay(new Date());
    const labels = [];
    const data = [];

    for (let i = 3; i >= 0; i -= 1) {
        const end = addDays(today, -(i * 7));
        const start = addDays(end, -6);
        labels.push(`Minggu ${4 - i}`);
        data.push(toMillions(sumDonationsInRange(donations, startOfDay(start), endOfDay(end))));
    }

    return { labels, data };
};

const buildYearSeries = (donations) => {
    const now = new Date();
    const labels = [];
    const data = [];

    for (let i = 11; i >= 0; i -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        labels.push(MONTH_NAMES[date.getMonth()]);
        data.push(toMillions(sumDonationsInRange(donations, start, end)));
    }

    return { labels, data };
};

const buildChartData = (donations) => ({
    week: buildWeekSeries(donations),
    month: buildMonthSeries(donations),
    year: buildYearSeries(donations)
});

const buildAnalytics = async (userId) => {
    const campaigns = await readData("campaigns");
    const donations = await readData("donations");

    const filteredDonations = userId
        ? donations.filter((donation) => donation.userId === userId)
        : donations;

    const totalDana = userId
        ? filteredDonations.reduce((sum, donation) => sum + normalizeAmount(donation.amount), 0)
        : campaigns.reduce((sum, item) => sum + normalizeAmount(item.currentAmount), 0);
    const totalDonatur = filteredDonations.length;
    const recentDonations = [...filteredDonations]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);

    return {
        totalDana,
        totalDonatur,
        chart: buildChartData(filteredDonations),
        recentDonations
    };
};

const createPaymentTransaction = async ({ amount, orderId, method }) => {
    const normalizedMethod = normalizePaymentMethod(method);

    if (pakasirClient) {
        try {
            let payment = await pakasirClient.createPayment(
                normalizedMethod,
                orderId,
                amount,
                PAKASIR_REDIRECT_URL || undefined
            );

            if (PAKASIR_SIMULATE) {
                const simulated = await pakasirClient.simulationPayment(orderId, amount);
                payment = simulated || payment;
            }

            return {
                gateway: "pakasir",
                status: payment?.status || "pending",
                referenceId: payment?.order_id || orderId,
                paymentUrl: payment?.payment_url || null,
                raw: payment || null
            };
        } catch (error) {
            // Fallback to simulation if SDK call fails.
        }
    }

    return {
        gateway: "pakasir",
        status: "completed",
        referenceId: orderId,
        paymentUrl: null,
        raw: null
    };
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(passport.initialize());

app.get("/auth/google", ensureGoogleOAuth, passport.authenticate("google", {
    scope: ["profile", "email"]
}));

app.get(
    "/auth/google/callback",
    ensureGoogleOAuth,
    passport.authenticate("google", {
        session: false,
        failureRedirect: "/login.html"
    }),
    (req, res) => {
        const userPayload = JSON.stringify(req.user).replace(/</g, "\\u003c");
        res.cookie("auth_user", req.user.id, { sameSite: "lax" });
        res.set("Content-Type", "text/html");
        res.send(`<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login berhasil</title>
</head>
<body>
    <script>
        const user = ${userPayload};
        localStorage.setItem("crowdfund_user", JSON.stringify(user));
        window.location.href = "/dashboard.html";
    </script>
</body>
</html>`);
    }
);

app.get("/dashboard.html", requirePageAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/buat-campaign.html", requirePageAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "buat-campaign.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
});

app.get("/api/analytics", requireAuth, async (req, res) => {
    const data = await buildAnalytics(req.authUser?.id);
    res.json(data);
});

app.get("/api/campaigns", async (req, res) => {
    const campaigns = await readData("campaigns");
    res.json(campaigns);
});

app.get("/api/campaigns/:id", async (req, res) => {
    const campaigns = await readData("campaigns");
    const campaign = campaigns.find((item) => item.id === req.params.id);
    if (!campaign) {
        res.status(404).json({ message: "Campaign not found" });
        return;
    }
    res.json(campaign);
});

app.post("/api/campaigns", requireAuth, async (req, res) => {
    const { title, category, targetAmount, deadline, story, imageUrl, organizer } = req.body;

    if (!title || !category || !targetAmount || !deadline || !story) {
        res.status(400).json({ message: "Data campaign belum lengkap." });
        return;
    }

    const campaigns = await readData("campaigns");
    const payload = {
        id: makeId("camp"),
        title,
        category,
        targetAmount: normalizeAmount(targetAmount),
        currentAmount: 0,
        deadline,
        imageUrl: imageUrl || "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=1000&auto=format&fit=crop",
        story,
        organizer: organizer || req.authUser?.name || "Penggalang Dana",
        createdAt: new Date().toISOString()
    };

    campaigns.push(payload);
    await writeData("campaigns", campaigns);

    res.status(201).json(payload);
});

app.put("/api/campaigns/:id", requireAuth, async (req, res) => {
    const campaigns = await readData("campaigns");
    const index = campaigns.findIndex((item) => item.id === req.params.id);
    if (index === -1) {
        res.status(404).json({ message: "Campaign not found" });
        return;
    }

    const updated = {
        ...campaigns[index],
        ...req.body
    };

    campaigns[index] = updated;
    await writeData("campaigns", campaigns);

    res.json(updated);
});

app.delete("/api/campaigns/:id", requireAuth, async (req, res) => {
    const campaigns = await readData("campaigns");
    const next = campaigns.filter((item) => item.id !== req.params.id);
    if (next.length === campaigns.length) {
        res.status(404).json({ message: "Campaign not found" });
        return;
    }

    await writeData("campaigns", next);
    res.json({ success: true });
});

app.post("/api/auth/register", async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        res.status(400).json({ message: "Data belum lengkap." });
        return;
    }

    const users = await readData("users");
    const exists = users.some((user) => user.email === email);
    if (exists) {
        res.status(409).json({ message: "Email sudah terdaftar." });
        return;
    }

    const payload = {
        id: makeId("user"),
        name,
        email,
        password,
        role: "user",
        createdAt: new Date().toISOString()
    };

    users.push(payload);
    await writeData("users", users);

    res.cookie("auth_user", payload.id, { sameSite: "lax" });
    res.status(201).json({ user: payload });
});

app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ message: "Email dan password wajib diisi." });
        return;
    }

    const users = await readData("users");
    const user = users.find((item) => item.email === email && item.password === password);
    if (!user) {
        res.status(401).json({ message: "Email atau password salah." });
        return;
    }

    res.cookie("auth_user", user.id, { sameSite: "lax" });
    res.json({ user });
});

app.post("/api/donations", requireAuth, async (req, res) => {
    const { campaignId, amount, donorName, method } = req.body;
    const normalizedAmount = normalizeAmount(amount);

    if (!campaignId || normalizedAmount < 10000) {
        res.status(400).json({ message: "Nominal donasi minimal Rp 10.000" });
        return;
    }

    const campaigns = await readData("campaigns");
    const donations = await readData("donations");
    const transactions = await readData("transactions");

    const campaignIndex = campaigns.findIndex((item) => item.id === campaignId);
    if (campaignIndex === -1) {
        res.status(404).json({ message: "Campaign tidak ditemukan" });
        return;
    }

    const donationPayload = {
        id: makeId("don"),
        campaignId,
        donorName: donorName || req.authUser?.name || "Hamba Allah",
        userId: req.authUser?.id || null,
        amount: normalizedAmount,
        method: method || "QRIS",
        createdAt: new Date().toISOString()
    };

    campaigns[campaignIndex].currentAmount = normalizeAmount(campaigns[campaignIndex].currentAmount) + normalizedAmount;

    donations.push(donationPayload);
    await writeData("donations", donations);
    await writeData("campaigns", campaigns);

    const orderId = `DON-${campaignId}-${Date.now()}`;
    const payment = await createPaymentTransaction({
        amount: normalizedAmount,
        orderId,
        method: donationPayload.method
    });

    const transactionPayload = {
        id: makeId("trx"),
        donationId: donationPayload.id,
        campaignId,
        amount: normalizedAmount,
        method: donationPayload.method,
        status: payment.status,
        gateway: payment.gateway,
        referenceId: payment.referenceId,
        paymentUrl: payment.paymentUrl || null,
        orderId,
        createdAt: new Date().toISOString()
    };

    transactions.push(transactionPayload);
    await writeData("transactions", transactions);

    const stats = await buildAnalytics(donationPayload.userId);
    const updatedCampaign = campaigns[campaignIndex];

    io.emit("donation:new", {
        userId: donationPayload.userId,
        donation: donationPayload,
        campaign: updatedCampaign,
        stats
    });

    res.status(201).json({
        donation: donationPayload,
        campaign: updatedCampaign,
        transaction: transactionPayload,
        stats
    });
});

const startServer = async () => {
    await ensureDataFiles();
    const port = process.env.PORT || 3000;

    server.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
};

startServer();
