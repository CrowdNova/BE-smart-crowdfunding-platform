const express = require("express");

const createApiRouter = ({
    readData,
    writeData,
    makeId,
    normalizeAmount,
    buildAnalytics,
    createPaymentTransaction,
    requireAuth,
    io
}) => {
    const router = express.Router();

    router.get("/health", (req, res) => {
        res.json({ status: "ok" });
    });

    router.get("/analytics", requireAuth, async (req, res) => {
        const data = await buildAnalytics(req.authUser?.id);
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
        res.json(campaign);
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

    router.post("/donations", requireAuth, async (req, res) => {
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

    return router;
};

module.exports = createApiRouter;
