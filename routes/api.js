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
