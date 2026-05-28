const express = require("express");

const createApiRouter = ({
    readData,
    writeData,
    makeId,
    normalizeAmount,
    buildAnalytics,
    createPaymentTransaction,
    requireAuth,
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

    router.get("/health", (req, res) => {
        res.json({ status: "ok" });
    });

    router.get("/analytics", requireAuth, async (req, res) => {
        const data = await buildAnalytics();
        res.json(data);
    });

    router.get("/campaigns", async (req, res) => {
        const campaigns = await readData("campaigns");
        res.json(campaigns);
    });

    router.get("/campaigns/:id", async (req, res) => {
        const campaigns = await readData("campaigns");
        const campaign = campaigns.find((item) => item.id === req.params.id);
        if (!campaign) {
            res.status(404).json({ message: "Campaign not found" });
            return;
        }

        // Count successful donations
        const donations = await readData("donations");
        const donorsCount = donations.filter((d) => d.campaignId === campaign.id).length;

        res.json({
            ...campaign,
            donorsCount
        });
    });

    router.post("/campaigns", requireAuth, async (req, res) => {
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
            userId: req.authUser?.id || null,
            createdAt: new Date().toISOString()
        };

        campaigns.push(payload);
        await writeData("campaigns", campaigns);

        res.status(201).json(payload);
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

        res.json({ user: sanitizeUser(updated) });
    });

    router.post("/donations", requireAuth, async (req, res) => {
        const { campaignId, amount, donorName, method } = req.body;
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
