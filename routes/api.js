const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname || "").toLowerCase();
            const base = path.basename(file.originalname || "campaign", ext)
                .replace(/[^a-z0-9_-]+/gi, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 40) || "campaign";
            cb(null, `${Date.now()}-${base}${ext}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith("image/")) {
            cb(new Error("File harus berupa gambar."));
            return;
        }
        cb(null, true);
    }
});

const createApiRouter = ({
    readData,
    writeData,
    makeId,
    normalizeAmount,
    buildAnalytics,
    createPaymentTransaction,
    requireAuth,
    getAuthUser,
    sendWhatsApp,
    io,
    createQris,
    checkStatus
}) => {
    const router = express.Router();

    const sanitizeUser = (user) => {
        if (!user) return null;
        const { password, ...safe } = user;
        return safe;
    };

    const updateUserRecord = async (userId, updates) => {
        const users = await readData("users");
        const index = users.findIndex((item) => item.id === userId);
        if (index === -1) return null;

        const updated = {
            ...users[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        users[index] = updated;
        await writeData("users", users);
        return updated;
    };

    const normalizeBoolean = (value, defaultValue) => {
        if (typeof value === "boolean") return value;
        if (value === "true" || value === "1") return true;
        if (value === "false" || value === "0") return false;
        return defaultValue;
    };

    const safeSendWhatsApp = async (number, message) => {
        if (!sendWhatsApp) return null;
        try {
            return await sendWhatsApp(number, message);
        } catch (error) {
            return null;
        }
    };

    const requireAdmin = (req, res, next) => {
        const user = req.authUser;
        if (!user) {
            res.status(401).json({ message: "Silakan login terlebih dahulu." });
            return;
        }
        if (user.role !== "admin") {
            res.status(403).json({ message: "Akses ditolak." });
            return;
        }
        next();
    };

    const getOptionalUser = async (req) => {
        if (!getAuthUser) return null;
        try {
            return await getAuthUser(req);
        } catch (error) {
            return null;
        }
    };

    const canManageCampaign = (campaign, user) => Boolean(user && (
        user.role === "admin" ||
        campaign.userId === user.id ||
        campaign.organizer === user.name
    ));

    const normalizeText = (value) => (value || "").toString().trim();

    router.get("/health", (req, res) => {
        res.json({ status: "ok" });
    });

    router.get("/analytics", requireAuth, async (req, res) => {
        const data = await buildAnalytics();
        res.json(data);
    });

    router.get("/campaigns", async (req, res) => {
        const campaigns = await readData("campaigns");
        const donations = await readData("donations");
        const q = normalizeText(req.query.q).toLowerCase();
        const category = normalizeText(req.query.category).toLowerCase();

        const visible = campaigns
            .filter((item) => item.status !== "pending" && item.status !== "rejected")
            .filter((item) => {
                if (!q) return true;
                const haystack = [
                    item.title,
                    item.category,
                    item.organizer,
                    item.story
                ].join(" ").toLowerCase();
                return haystack.includes(q);
            })
            .filter((item) => !category || (item.category || "").toLowerCase() === category)
            .map((campaign) => ({
                ...campaign,
                donorsCount: donations.filter((d) => d.campaignId === campaign.id).length
            }));

        res.json(visible);
    });

    router.get("/campaigns/:id", async (req, res) => {
        const campaigns = await readData("campaigns");
        const campaign = campaigns.find((item) => item.id === req.params.id);
        if (!campaign) {
            res.status(404).json({ message: "Campaign not found" });
            return;
        }

        if (campaign.status === "pending" || campaign.status === "rejected") {
            const user = await getOptionalUser(req);
            const isOwner = user && (
                campaign.userId === user.id ||
                campaign.organizer === user.name
            );
            const isAdmin = user && user.role === "admin";
            if (!isOwner && !isAdmin) {
                res.status(404).json({ message: "Campaign not found" });
                return;
            }
        }

        // Count successful donations
        const user = await getOptionalUser(req);
        const donations = await readData("donations");
        const campaignDonations = donations
            .filter((d) => d.campaignId === campaign.id)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const donorsCount = campaignDonations.length;
        const recentDonations = campaignDonations.slice(0, 10).map((donation) => ({
            id: donation.id,
            donorName: donation.donorName || "Hamba Allah",
            amount: donation.amount,
            method: donation.method,
            message: donation.message || "",
            createdAt: donation.createdAt
        }));

        res.json({
            ...campaign,
            donorsCount,
            recentDonations,
            canManage: canManageCampaign(campaign, user)
        });
    });

    router.post("/campaigns", requireAuth, upload.single("imageFile"), async (req, res) => {
        const { title, category, targetAmount, deadline, story, imageUrl, organizer } = req.body;

        if (!title || !category || !targetAmount || !deadline || !story) {
            res.status(400).json({ message: "Data campaign belum lengkap." });
            return;
        }

        const campaigns = await readData("campaigns");
        const isAdmin = req.authUser?.role === "admin";
        const status = isAdmin ? "approved" : "pending";

        const payload = {
            id: makeId("camp"),
            title,
            category,
            targetAmount: normalizeAmount(targetAmount),
            currentAmount: 0,
            deadline,
            imageUrl: req.file ? `/uploads/${req.file.filename}` : imageUrl || "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=1000&auto=format&fit=crop",
            story,
            organizer: organizer || req.authUser?.name || "Penggalang Dana",
            userId: req.authUser?.id || null,
            status,
            updates: [],
            approvedAt: status === "approved" ? new Date().toISOString() : null,
            createdAt: new Date().toISOString()
        };

        campaigns.push(payload);
        await writeData("campaigns", campaigns);

        res.status(201).json(payload);
    });

    router.post("/campaigns/:id/updates", requireAuth, async (req, res) => {
        const campaigns = await readData("campaigns");
        const index = campaigns.findIndex((item) => item.id === req.params.id);
        if (index === -1) {
            res.status(404).json({ message: "Campaign tidak ditemukan." });
            return;
        }

        const campaign = campaigns[index];
        if (!canManageCampaign(campaign, req.authUser)) {
            res.status(403).json({ message: "Anda tidak memiliki akses untuk update campaign ini." });
            return;
        }

        const title = normalizeText(req.body.title);
        const body = normalizeText(req.body.body);
        const progressPercent = Number(req.body.progressPercent);

        if (!title || !body) {
            res.status(400).json({ message: "Judul dan isi update wajib diisi." });
            return;
        }

        const update = {
            id: makeId("upd"),
            title,
            body,
            progressPercent: Number.isFinite(progressPercent)
                ? Math.max(0, Math.min(100, Math.round(progressPercent)))
                : null,
            userId: req.authUser.id,
            authorName: req.authUser.name || "Penggalang Dana",
            createdAt: new Date().toISOString()
        };

        const updates = Array.isArray(campaign.updates) ? campaign.updates : [];
        campaigns[index] = {
            ...campaign,
            updates: [update, ...updates],
            updatedAt: new Date().toISOString()
        };

        await writeData("campaigns", campaigns);

        io.emit("campaign:update", {
            campaignId: campaign.id,
            update,
            campaign: campaigns[index]
        });

        res.status(201).json({ update, campaign: campaigns[index] });
    });

    router.put("/campaigns/:id", requireAuth, async (req, res) => {
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

    router.delete("/campaigns/:id", requireAuth, async (req, res) => {
        const campaigns = await readData("campaigns");
        const next = campaigns.filter((item) => item.id !== req.params.id);
        if (next.length === campaigns.length) {
            res.status(404).json({ message: "Campaign not found" });
            return;
        }

        await writeData("campaigns", next);
        res.json({ success: true });
    });

    router.get("/my-campaigns", requireAuth, async (req, res) => {
        const campaigns = await readData("campaigns");
        const donations = await readData("donations");

        const mine = campaigns.filter((campaign) => (
            campaign.userId === req.authUser.id ||
            campaign.organizer === req.authUser.name
        ));

        const campaignsWithStats = mine.map((campaign) => {
            const donorsCount = donations.filter((d) => d.campaignId === campaign.id).length;
            return { ...campaign, donorsCount };
        });

        const totalCampaigns = campaignsWithStats.length;
        const totalDana = campaignsWithStats.reduce((sum, item) => sum + normalizeAmount(item.currentAmount), 0);
        const totalDonatur = campaignsWithStats.reduce((sum, item) => sum + (item.donorsCount || 0), 0);

        res.json({
            campaigns: campaignsWithStats,
            stats: { totalCampaigns, totalDana, totalDonatur }
        });
    });

    router.post("/auth/register", async (req, res) => {
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
            status: "active",
            phone: "",
            notificationPrefs: {
                donation: true,
                campaign: true,
                newsletter: false
            },
            createdAt: new Date().toISOString()
        };

        users.push(payload);
        await writeData("users", users);

        res.cookie("auth_user", payload.id, { sameSite: "lax" });
        res.status(201).json({ user: payload });
    });

    router.post("/auth/login", async (req, res) => {
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
        if (user.status === "disabled") {
            res.status(403).json({ message: "Akun dinonaktifkan." });
            return;
        }

        res.cookie("auth_user", user.id, { sameSite: "lax" });
        res.json({ user });
    });

    router.patch("/settings/profile", requireAuth, async (req, res) => {
        const name = (req.body.name || "").toString().trim();
        const phone = (req.body.phone || "").toString().trim();

        if (!name) {
            res.status(400).json({ message: "Nama lengkap wajib diisi." });
            return;
        }

        const updated = await updateUserRecord(req.authUser.id, {
            name,
            phone
        });

        if (!updated) {
            res.status(404).json({ message: "Pengguna tidak ditemukan." });
            return;
        }

        res.json({ user: sanitizeUser(updated) });
    });

    router.patch("/settings/notifications", requireAuth, async (req, res) => {
        const current = req.authUser.notificationPrefs || {
            donation: true,
            campaign: true,
            newsletter: false
        };

        const notificationPrefs = {
            donation: normalizeBoolean(req.body.donation, current.donation),
            campaign: normalizeBoolean(req.body.campaign, current.campaign),
            newsletter: normalizeBoolean(req.body.newsletter, current.newsletter)
        };

        const updated = await updateUserRecord(req.authUser.id, { notificationPrefs });
        if (!updated) {
            res.status(404).json({ message: "Pengguna tidak ditemukan." });
            return;
        }

        res.json({ user: sanitizeUser(updated) });
    });

    router.patch("/settings/security", requireAuth, async (req, res) => {
        const newPassword = (req.body.newPassword || "").toString();
        const confirmPassword = (req.body.confirmPassword || "").toString();

        if (!newPassword || newPassword.length < 6) {
            res.status(400).json({ message: "Password minimal 6 karakter." });
            return;
        }

        if (newPassword !== confirmPassword) {
            res.status(400).json({ message: "Konfirmasi password tidak cocok." });
            return;
        }

        const updated = await updateUserRecord(req.authUser.id, { password: newPassword });
        if (!updated) {
            res.status(404).json({ message: "Pengguna tidak ditemukan." });
            return;
        }

        if (updated.phone) {
            safeSendWhatsApp(updated.phone, "Password akun Anda berhasil diperbarui. Jika ini bukan Anda, segera hubungi admin.");
        }

        res.json({ user: sanitizeUser(updated) });
    });

    router.get("/admin/summary", requireAuth, requireAdmin, async (req, res) => {
        const users = await readData("users");
        const campaigns = await readData("campaigns");
        const donations = await readData("donations");
        const chats = await readData("supportChats");

        const totalUsers = users.length;
        const activeUsers = users.filter((u) => u.status !== "disabled").length;
        const totalCampaigns = campaigns.length;
        const pendingCampaigns = campaigns.filter((c) => c.status === "pending").length;
        const totalDonations = donations.reduce((sum, item) => sum + normalizeAmount(item.amount), 0);

        const ratedChats = chats.filter((c) => c.rating);
        const avgRating = ratedChats.length
            ? (ratedChats.reduce((sum, c) => sum + c.rating, 0) / ratedChats.length).toFixed(1)
            : null;

        const queueLength = chats.filter((c) => {
            if (c.status !== "open") return false;
            return !(c.messages || []).some((m) => m.senderRole === "admin");
        }).length;

        const respondedChats = chats.filter((c) => c.firstResponseAt);
        let avgResponseSeconds = null;
        if (respondedChats.length) {
            const totalSeconds = respondedChats.reduce((sum, c) => {
                const created = new Date(c.createdAt).getTime();
                const responded = new Date(c.firstResponseAt).getTime();
                return sum + (responded - created);
            }, 0);
            avgResponseSeconds = Math.round(totalSeconds / respondedChats.length / 1000);
        }

        res.json({
            totalUsers,
            activeUsers,
            totalCampaigns,
            pendingCampaigns,
            totalDonations,
            avgRating,
            totalRated: ratedChats.length,
            queueLength,
            avgResponseSeconds
        });
    });

    router.get("/admin/campaigns", requireAuth, requireAdmin, async (req, res) => {
        const campaigns = await readData("campaigns");
        const donations = await readData("donations");

        const mapped = campaigns.map((campaign) => {
            const donorsCount = donations.filter((d) => d.campaignId === campaign.id).length;
            return { ...campaign, donorsCount };
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ campaigns: mapped });
    });

    router.patch("/admin/campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
        const { status } = req.body;
        const allowed = ["pending", "approved", "rejected"];
        if (status && !allowed.includes(status)) {
            res.status(400).json({ message: "Status campaign tidak valid." });
            return;
        }

        const campaigns = await readData("campaigns");
        const index = campaigns.findIndex((item) => item.id === req.params.id);
        if (index === -1) {
            res.status(404).json({ message: "Campaign tidak ditemukan." });
            return;
        }

        const previousStatus = campaigns[index].status || "pending";

        campaigns[index] = {
            ...campaigns[index],
            ...req.body,
            status: status || campaigns[index].status || "pending",
            approvedAt: status === "approved" ? new Date().toISOString() : campaigns[index].approvedAt || null
        };

        await writeData("campaigns", campaigns);

        if (status === "approved" && previousStatus !== "approved") {
            const users = await readData("users");
            const owner = users.find((user) => user.id === campaigns[index].userId);
            if (owner?.phone) {
                safeSendWhatsApp(owner.phone, `Campaign Anda "${campaigns[index].title}" telah disetujui admin dan sekarang tampil di aplikasi.`);
            }
        }

        res.json({ campaign: campaigns[index] });
    });

    router.delete("/admin/campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
        const campaigns = await readData("campaigns");
        const next = campaigns.filter((item) => item.id !== req.params.id);
        if (next.length === campaigns.length) {
            res.status(404).json({ message: "Campaign tidak ditemukan." });
            return;
        }

        await writeData("campaigns", next);
        res.json({ success: true });
    });

    router.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
        const users = await readData("users");
        const payload = users.map((user) => {
            const sanitized = sanitizeUser(user);
            return {
                ...sanitized,
                status: user.status || "active"
            };
        });

        res.json({ users: payload });
    });

    router.patch("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
        const { role, status, name, phone, password } = req.body;
        const updates = {};

        if (role && !["admin", "user"].includes(role)) {
            res.status(400).json({ message: "Role tidak valid." });
            return;
        }

        if (status && !["active", "disabled"].includes(status)) {
            res.status(400).json({ message: "Status akun tidak valid." });
            return;
        }

        if (role) updates.role = role;
        if (status) updates.status = status;
        if (name) updates.name = name;
        if (typeof phone === "string") updates.phone = phone;
        if (password) updates.password = password;

        const updated = await updateUserRecord(req.params.id, updates);
        if (!updated) {
            res.status(404).json({ message: "Pengguna tidak ditemukan." });
            return;
        }

        res.json({ user: sanitizeUser(updated) });
    });

    router.get("/admin/donations", requireAuth, requireAdmin, async (req, res) => {
        const donations = await readData("donations");
        const campaigns = await readData("campaigns");
        const users = await readData("users");

        const mapped = donations.map((donation) => {
            const campaign = campaigns.find((item) => item.id === donation.campaignId);
            const user = users.find((item) => item.id === donation.userId);
            return {
                ...donation,
                campaignTitle: campaign?.title || "Campaign",
                organizer: campaign?.organizer || "Penggalang Dana",
                userName: user?.name || donation.donorName || "-"
            };
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ donations: mapped });
    });

    router.get("/support/chat", requireAuth, async (req, res) => {
        const chats = await readData("supportChats");
        const userChats = chats
            .filter((chat) => chat.userId === req.authUser.id)
            .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

        const currentChat = userChats[0] || null;

        if (currentChat) {
            const openWithoutReply = chats.filter((c) => {
                if (c.status !== "open") return false;
                return !(c.messages || []).some((m) => m.senderRole === "admin");
            });
            const myIndex = openWithoutReply.findIndex((c) => c.id === currentChat.id);
            currentChat.queuePosition = myIndex !== -1 ? myIndex + 1 : null;
        }

        res.json({
            chats: userChats,
            chat: currentChat
        });
    });

    router.post("/support/chat", requireAuth, async (req, res) => {
        const message = normalizeText(req.body.message);
        const subject = normalizeText(req.body.subject) || "Pertanyaan customer service";
        const requestedThreadId = normalizeText(req.body.threadId);

        if (!message) {
            res.status(400).json({ message: "Pesan tidak boleh kosong." });
            return;
        }

        const chats = await readData("supportChats");
        const now = new Date().toISOString();
        let index = requestedThreadId
            ? chats.findIndex((chat) => chat.id === requestedThreadId && chat.userId === req.authUser.id)
            : -1;

        if (index === -1) {
            index = chats.findIndex((chat) => chat.userId === req.authUser.id && chat.status !== "closed");
        }

        const supportMessage = {
            id: makeId("msg"),
            senderId: req.authUser.id,
            senderName: req.authUser.name || "User",
            senderRole: "user",
            message,
            createdAt: now,
            readAt: null
        };

        if (index === -1) {
            const queuePosition = (chats.filter((c) => {
                if (c.status !== "open") return false;
                const hasAdminReply = (c.messages || []).some((m) => m.senderRole === "admin");
                return !hasAdminReply;
            })).length + 1;

            const chat = {
                id: makeId("chat"),
                userId: req.authUser.id,
                userName: req.authUser.name || "User",
                userEmail: req.authUser.email || "",
                subject: subject.slice(0, 120),
                status: "open",
                createdAt: now,
                updatedAt: now,
                messages: [supportMessage],
                queuePosition,
                firstResponseAt: null,
                rating: null,
                feedback: null,
                ratedAt: null
            };

            chats.push(chat);
            await writeData("supportChats", chats);
            io.emit("support:update", { chat });
            res.status(201).json({ chat });
            return;
        }

        const updatedMessages = (chats[index].messages || []).map((msg) => {
            if (msg.senderRole === "admin" && !msg.readAt) {
                return { ...msg, readAt: now };
            }
            return msg;
        });

        chats[index] = {
            ...chats[index],
            status: "open",
            updatedAt: now,
            messages: [...updatedMessages, supportMessage]
        };

        await writeData("supportChats", chats);
        io.emit("support:update", { chat: chats[index] });
        res.json({ chat: chats[index] });
    });

    router.get("/admin/support-chats", requireAuth, requireAdmin, async (req, res) => {
        const chats = await readData("supportChats");
        const now = new Date().toISOString();
        let changed = false;

        const mapped = chats
            .map((chat) => {
                const messages = Array.isArray(chat.messages) ? chat.messages : [];
                const updatedMessages = messages.map((msg) => {
                    if (msg.senderRole === "user" && !msg.readAt) {
                        changed = true;
                        return { ...msg, readAt: now };
                    }
                    return msg;
                });
                return { ...chat, messages: updatedMessages };
            })
            .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

        if (changed) {
            await writeData("supportChats", mapped);
        }

        res.json({ chats: mapped });
    });

    router.post("/admin/support-chats/:id/reply", requireAuth, requireAdmin, async (req, res) => {
        const message = normalizeText(req.body.message);
        if (!message) {
            res.status(400).json({ message: "Balasan tidak boleh kosong." });
            return;
        }

        const chats = await readData("supportChats");
        const index = chats.findIndex((chat) => chat.id === req.params.id);
        if (index === -1) {
            res.status(404).json({ message: "Chat tidak ditemukan." });
            return;
        }

        const now = new Date().toISOString();
        const supportMessage = {
            id: makeId("msg"),
            senderId: req.authUser.id,
            senderName: req.authUser.name || "Admin",
            senderRole: "admin",
            message,
            createdAt: now,
            readAt: null
        };

        const updatedMessages = (chats[index].messages || []).map((msg) => {
            if (msg.senderRole === "user" && !msg.readAt) {
                return { ...msg, readAt: now };
            }
            return msg;
        });

        const hasAdminReply = (chats[index].messages || []).some((m) => m.senderRole === "admin");

        chats[index] = {
            ...chats[index],
            status: "open",
            updatedAt: now,
            firstResponseAt: chats[index].firstResponseAt || (!hasAdminReply ? now : undefined),
            messages: [...updatedMessages, supportMessage]
        };

        await writeData("supportChats", chats);
        io.emit("support:update", { chat: chats[index] });
        res.json({ chat: chats[index] });
    });

    router.patch("/support/chat/:id/read", requireAuth, async (req, res) => {
        const chats = await readData("supportChats");
        const index = chats.findIndex((chat) => chat.id === req.params.id);
        if (index === -1) {
            res.status(404).json({ message: "Chat tidak ditemukan." });
            return;
        }

        if (chats[index].userId !== req.authUser.id && req.authUser.role !== "admin") {
            res.status(403).json({ message: "Akses ditolak." });
            return;
        }

        const now = new Date().toISOString();
        let changed = false;

        const updatedMessages = (chats[index].messages || []).map((msg) => {
            if (msg.senderRole !== (req.authUser.role === "admin" ? "user" : "admin") && !msg.readAt) {
                changed = true;
                return { ...msg, readAt: now };
            }
            return msg;
        });

        if (changed) {
            chats[index] = {
                ...chats[index],
                messages: updatedMessages,
                updatedAt: now
            };
            await writeData("supportChats", chats);
            io.emit("support:update", { chat: chats[index] });
        }

        res.json({ chat: chats[index] });
    });

    router.post("/support/chat/:id/rating", requireAuth, async (req, res) => {
        const { rating, feedback } = req.body;
        const ratingNum = parseInt(rating, 10);

        if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
            res.status(400).json({ message: "Rating harus antara 1-5." });
            return;
        }

        const chats = await readData("supportChats");
        const index = chats.findIndex((chat) => chat.id === req.params.id && chat.userId === req.authUser.id);
        if (index === -1) {
            res.status(404).json({ message: "Chat tidak ditemukan." });
            return;
        }

        if (chats[index].status !== "closed") {
            res.status(400).json({ message: "Hanya bisa memberi rating setelah chat ditutup." });
            return;
        }

        if (chats[index].rating) {
            res.status(400).json({ message: "Kamu sudah memberi rating untuk chat ini." });
            return;
        }

        const now = new Date().toISOString();
        chats[index] = {
            ...chats[index],
            rating: ratingNum,
            feedback: (feedback || "").trim().slice(0, 500) || null,
            ratedAt: now,
            updatedAt: now
        };

        await writeData("supportChats", chats);
        io.emit("support:update", { chat: chats[index] });
        res.json({ chat: chats[index] });
    });

    router.patch("/admin/support-chats/:id", requireAuth, requireAdmin, async (req, res) => {
        const status = normalizeText(req.body.status);
        if (!["open", "closed"].includes(status)) {
            res.status(400).json({ message: "Status chat tidak valid." });
            return;
        }

        const chats = await readData("supportChats");
        const index = chats.findIndex((chat) => chat.id === req.params.id);
        if (index === -1) {
            res.status(404).json({ message: "Chat tidak ditemukan." });
            return;
        }

        chats[index] = {
            ...chats[index],
            status,
            updatedAt: new Date().toISOString()
        };

        await writeData("supportChats", chats);
        io.emit("support:update", { chat: chats[index] });
        res.json({ chat: chats[index] });
    });

    router.post("/donations", requireAuth, async (req, res) => {
        const { campaignId, amount, donorName, method, message } = req.body;
        const normalizedAmount = normalizeAmount(amount);

        if (!campaignId || normalizedAmount < 10000) {
            res.status(400).json({ message: "Nominal donasi minimal Rp 10.000" });
            return;
        }

        const campaigns = await readData("campaigns");
        const transactions = await readData("transactions");

        const campaignIndex = campaigns.findIndex((item) => item.id === campaignId);
        if (campaignIndex === -1) {
            res.status(404).json({ message: "Campaign tidak ditemukan" });
            return;
        }

        const orderId = 'CF-' + Math.random().toString(36).substring(2, 10).toUpperCase();

        // Call the real Pakasir QRIS API or fallback to demoMode
        let payment = null;
        let demoMode = false;
        try {
            payment = await createQris(orderId, normalizedAmount);
        } catch (error) {
            console.warn("Pakasir API error, falling back to demo mode:", error.message);
            demoMode = true;
            payment = {
                order_id: orderId,
                amount: normalizedAmount,
                payment_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=CROWDFUND-DEMO-PAYMENT-${orderId}`,
                qr_image: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=CROWDFUND-DEMO-PAYMENT-${orderId}`,
                status: "pending"
            };
        }

        const transactionPayload = {
            id: makeId("trx"),
            campaignId,
            amount: normalizedAmount,
            method: method || "qris",
            status: "pending",
            gateway: "pakasir",
            referenceId: payment.order_id || orderId,
            paymentUrl: payment.payment_url || null,
            qrImage: payment.qr_image || payment.payment_url || null,
            orderId,
            donorName: donorName || req.authUser?.name || "Hamba Allah",
            message: normalizeText(message).slice(0, 240),
            userId: req.authUser?.id || null,
            demoMode,
            createdAt: new Date().toISOString()
        };

        transactions.push(transactionPayload);
        await writeData("transactions", transactions);

        res.status(201).json({
            transaction: transactionPayload
        });
    });

    router.get("/my-donations", requireAuth, async (req, res) => {
        const donations = await readData("donations");
        const campaigns = await readData("campaigns");

        const mine = donations.filter((donation) => (
            donation.userId === req.authUser.id ||
            donation.donorName === req.authUser.name
        ));

        const mapped = mine.map((donation) => {
            const campaign = campaigns.find((item) => item.id === donation.campaignId);
            return {
                ...donation,
                campaignTitle: campaign?.title || "Campaign",
                campaignImage: campaign?.imageUrl || null,
                organizer: campaign?.organizer || "Penggalang Dana"
            };
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const totalDonasi = mapped.reduce((sum, item) => sum + normalizeAmount(item.amount), 0);
        const totalTransaksi = mapped.length;
        const uniqueCampaigns = new Set(mapped.map((item) => item.campaignId)).size;

        res.json({
            donations: mapped,
            stats: { totalDonasi, totalTransaksi, uniqueCampaigns }
        });
    });

    router.get("/transactions/:orderId/check", requireAuth, async (req, res) => {
        const { orderId } = req.params;
        const transactions = await readData("transactions");
        const trxIndex = transactions.findIndex((t) => t.orderId === orderId);

        if (trxIndex === -1) {
            res.status(404).json({ message: "Transaksi tidak ditemukan." });
            return;
        }

        const transaction = transactions[trxIndex];

        if (transaction.status === "completed" || transaction.status === "paid") {
            const campaigns = await readData("campaigns");
            const campaign = campaigns.find((c) => c.id === transaction.campaignId);
            const stats = await buildAnalytics();
            res.json({
                status: "completed",
                transaction,
                campaign,
                stats
            });
            return;
        }

        let isPaid = false;
        let pakasirTrx = null;

        if (transaction.demoMode) {
            if (req.query.simulateSuccess === "true") {
                isPaid = true;
            }
        } else {
            try {
                pakasirTrx = await checkStatus(orderId, transaction.amount);
                const statusStr = (pakasirTrx?.status || "").toLowerCase();
                if (statusStr === "paid" || statusStr === "success" || statusStr === "completed") {
                    isPaid = true;
                }
            } catch (error) {
                console.error("Error checking Pakasir transaction status:", error.message);
            }
        }

        if (isPaid) {
            transaction.status = "completed";
            transaction.paidAt = new Date().toISOString();

            const donations = await readData("donations");
            const donationPayload = {
                id: makeId("don"),
                campaignId: transaction.campaignId,
                donorName: transaction.donorName,
                userId: transaction.userId,
                amount: transaction.amount,
                method: transaction.method,
                message: transaction.message || "",
                createdAt: new Date().toISOString()
            };
            donations.push(donationPayload);
            await writeData("donations", donations);

            transaction.donationId = donationPayload.id;

            const campaigns = await readData("campaigns");
            const campaignIndex = campaigns.findIndex((c) => c.id === transaction.campaignId);
            let updatedCampaign = null;
            if (campaignIndex !== -1) {
                campaigns[campaignIndex].currentAmount = normalizeAmount(campaigns[campaignIndex].currentAmount) + transaction.amount;
                await writeData("campaigns", campaigns);
                updatedCampaign = campaigns[campaignIndex];
            }

            await writeData("transactions", transactions);

            const stats = await buildAnalytics();

            if (transaction.userId) {
                const users = await readData("users");
                const user = users.find((item) => item.id === transaction.userId);
                if (user?.phone) {
                    const amountText = new Intl.NumberFormat("id-ID", {
                        style: "currency",
                        currency: "IDR",
                        minimumFractionDigits: 0
                    }).format(transaction.amount);
                    safeSendWhatsApp(user.phone, `Terima kasih! Donasi Anda sebesar ${amountText} untuk campaign "${updatedCampaign?.title || "Campaign"}" telah berhasil.`);
                }
            }

            io.emit("donation:new", {
                userId: transaction.userId,
                donation: donationPayload,
                campaign: updatedCampaign,
                stats
            });

            res.json({
                status: "completed",
                transaction,
                campaign: updatedCampaign,
                stats
            });
        } else {
            res.json({
                status: "pending",
                transaction
            });
        }
    });

    return router;
};

module.exports = createApiRouter;
