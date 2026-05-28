const API_BASE = "";

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

const state = {
    chartInstance: null,
    chartData: DEFAULT_CHART_DATA,
    campaigns: [],
    currentCampaignId: null,
    currentCampaignCurrentAmount: 0
};

const getCurrentUser = () => {
    try {
        return JSON.parse(localStorage.getItem("crowdfund_user") || "null");
    } catch (error) {
        return null;
    }
};

const updateLocalUser = (updates) => {
    const current = getCurrentUser() || {};
    const next = { ...current, ...updates };
    localStorage.setItem("crowdfund_user", JSON.stringify(next));
    return next;
};

const isAuthenticated = () => {
    const user = getCurrentUser();
    return Boolean(user && user.id);
};

const getAuthHeaders = () => {
    const user = getCurrentUser();
    if (!user || !user.id) return {};
    return {
        "x-user-id": user.id,
        "x-user-email": user.email || ""
    };
};

const handleUnauthorized = () => {
    localStorage.removeItem("crowdfund_user");
    const path = window.location.pathname.replace(/\/$/, "") || "/";
    if (path !== "/login") {
        window.location.href = "/login";
    }
};

const formatRupiah = (number) => {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0
    }).format(number);
};

const formatDateTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
};

const fetchJson = async (url, options = {}) => {
    const response = await fetch(`${API_BASE}${url}`, {
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
            ...(options.headers || {})
        },
        ...options
    });

    if (!response.ok) {
        if (response.status === 401) {
            handleUnauthorized();
        }
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Terjadi kesalahan pada server.");
    }

    return response.json();
};

const showAlert = (title, text, icon = "info") => {
    if (window.Swal) {
        Swal.fire(title, text, icon);
        return;
    }
    alert(`${title}\n${text}`);
};

const escapeHtml = (value) => {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
};

const setChartData = (data) => {
    state.chartData = data || DEFAULT_CHART_DATA;
    updateChart("month");
};

const initChart = () => {
    const canvas = document.getElementById("donationChart");
    if (!canvas || !window.Chart) return;

    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, "rgba(34, 197, 94, 0.2)");
    gradient.addColorStop(1, "rgba(34, 197, 94, 0)");

    state.chartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: state.chartData.month.labels,
            datasets: [
                {
                    label: "Donasi Masuk (Juta Rp)",
                    data: state.chartData.month.data,
                    borderColor: "#16a34a",
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointBackgroundColor: "#ffffff",
                    pointBorderColor: "#16a34a",
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: "#f1f5f9" } },
                x: { grid: { display: false } }
            }
        }
    });
};

const updateChart = (period) => {
    if (!state.chartInstance || !state.chartData[period]) return;

    document.querySelectorAll(".chart-filter-btn").forEach((btn) => {
        btn.classList.remove("bg-white", "text-slate-900", "shadow-sm");
        btn.classList.add("text-slate-500");
    });

    const activeBtn = document.getElementById(`btn-filter-${period}`);
    if (activeBtn) {
        activeBtn.classList.remove("text-slate-500");
        activeBtn.classList.add("bg-white", "text-slate-900", "shadow-sm");
    }

    state.chartInstance.data.labels = state.chartData[period].labels;
    state.chartInstance.data.datasets[0].data = state.chartData[period].data;
    state.chartInstance.update();
};

window.updateChart = updateChart;

const getCampaignById = (id) => {
    return state.campaigns.find((campaign) => campaign.id === id);
};

const updateCampaignCard = (card, campaign) => {
    if (!campaign) return;

    const categoryEl = card.querySelector("[data-campaign-category]");
    const titleEl = card.querySelector("[data-campaign-title]");
    const currentEl = card.querySelector("[data-campaign-current]");
    const targetEl = card.querySelector("[data-campaign-target]");
    const progressEl = card.querySelector("[data-campaign-progress]");
    const imageEl = card.querySelector("[data-campaign-image]");
    const linkEls = card.querySelectorAll("[data-campaign-link]");

    if (categoryEl) categoryEl.textContent = campaign.category || "Campaign";
    if (titleEl) titleEl.textContent = campaign.title || "Campaign";
    if (currentEl) currentEl.textContent = formatRupiah(campaign.currentAmount || 0);
    if (targetEl) targetEl.textContent = `Target ${formatRupiah(campaign.targetAmount || 0)}`;
    if (imageEl && campaign.imageUrl) imageEl.src = campaign.imageUrl;

    const progress = campaign.targetAmount
        ? (campaign.currentAmount / campaign.targetAmount) * 100
        : 0;
    if (progressEl) progressEl.style.width = `${Math.min(progress, 100)}%`;

    linkEls.forEach((link) => {
        link.setAttribute("href", `/campaign/${campaign.id}`);
    });
};

const renderCampaignGrid = () => {
    const grid = document.getElementById("campaignGrid");
    if (!grid) return;

    if (!state.campaigns || state.campaigns.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-12 bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center">
                <i class="ph ph-megaphone text-4xl text-slate-300 mb-2"></i>
                <p class="text-slate-500 font-medium">Belum ada campaign aktif.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = state.campaigns.map((campaign) => {
        const progress = campaign.targetAmount
            ? Math.min((campaign.currentAmount / campaign.targetAmount) * 100, 100)
            : 0;

        let colorClass = "text-primary-600";
        let progressBg = "bg-primary-500";
        let btnClass = "bg-primary-50 hover:bg-primary-100 text-primary-700 border-primary-200";

        if (campaign.category === "Pendidikan") {
            colorClass = "text-blue-600";
            progressBg = "bg-blue-500";
            btnClass = "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200";
        } else if (campaign.category === "Bantuan Medis") {
            colorClass = "text-rose-600";
            progressBg = "bg-rose-500";
            btnClass = "bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200";
        }

        return `
            <div class="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 flex flex-col" data-campaign-card data-campaign-id="${campaign.id}">
                <a class="h-48 bg-slate-200 cursor-pointer block" href="/campaign/${campaign.id}">
                    <img src="${campaign.imageUrl || 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=600&auto=format&fit=crop'}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
                </a>
                <div class="p-5 flex-1 flex flex-col">
                    <div class="text-xs font-medium ${colorClass} mb-2">${escapeHtml(campaign.category || 'Campaign')}</div>
                    <a class="font-bold text-slate-900 mb-2 hover:text-primary-600 cursor-pointer transition-colors" href="/campaign/${campaign.id}">${escapeHtml(campaign.title)}</a>
                    <div class="mt-auto">
                        <div class="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
                            <div class="${progressBg} h-2 rounded-full" style="width: ${progress}%"></div>
                        </div>
                        <div class="flex justify-between text-sm mb-4">
                            <span class="font-bold">${formatRupiah(campaign.currentAmount || 0)}</span>
                            <span class="text-slate-400">Target ${formatRupiah(campaign.targetAmount || 0)}</span>
                        </div>
                        <button class="w-full ${btnClass} font-semibold py-2.5 rounded-lg border transition-colors" onclick="openDonationModal('${campaign.id}')">
                            Donasi Sekarang
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");
};

const syncCampaignCards = () => {
    renderCampaignGrid();
};

const syncDonationButtons = () => {
    // Buttons are dynamically handled via onclick on campaign cards.
};

const updateStatsUI = (stats) => {
    const totalDanaEl = document.getElementById("stat-total-dana");
    const totalDonaturEl = document.getElementById("stat-total-donatur");
    const activeCampaignsEl = document.getElementById("stat-campaign-aktif");

    if (totalDanaEl) totalDanaEl.textContent = formatRupiah(stats.totalDana || 0);
    if (totalDonaturEl) totalDonaturEl.textContent = (stats.totalDonatur || 0).toLocaleString("id-ID");
    if (activeCampaignsEl) activeCampaignsEl.textContent = (stats.activeCampaigns || 0).toString();
};

const addRecentTransaction = (donation) => {
    const list = document.getElementById("recent-transactions-list");
    if (!list) return;

    const itemHTML = `
        <div class="flex items-center justify-between py-3 border-b border-slate-50 last:border-0 bg-emerald-50/50 rounded-lg px-2 -mx-2">
            <div class="flex items-center space-x-3">
                <div class="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-xs">${(donation.donorName || "Anda").slice(0, 2).toUpperCase()}</div>
                <div>
                    <p class="text-sm font-medium text-slate-900">Donasi Baru</p>
                    <p class="text-xs text-slate-500">${donation.donorName || "Hamba Allah"}</p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-sm font-bold text-emerald-600">+${formatRupiah(donation.amount)}</p>
                <p class="text-xs text-emerald-500">Baru saja</p>
            </div>
        </div>
    `;

    list.insertAdjacentHTML("afterbegin", itemHTML);
};

const showToast = (title, message) => {
    const container = document.getElementById("toastContainer");
    if (!container) {
        showAlert(title, message, "success");
        return;
    }

    const toast = document.createElement("div");
    toast.className = "toast-enter bg-white border border-slate-100 shadow-lg rounded-xl p-4 flex items-start space-x-3 w-80 pointer-events-auto";
    toast.innerHTML = `
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <i class="ph-fill ph-whatsapp-logo text-green-600 text-xl"></i>
        </div>
        <div class="flex-1">
            <p class="text-sm font-bold text-slate-900">${title}</p>
            <p class="text-xs text-slate-500 mt-0.5">${message}</p>
        </div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("toast-exit");
        setTimeout(() => toast.remove(), 300);
    }, 5000);
};

const guardProtectedRoutes = () => {
    const protectedPages = [
        "/dashboard",
        "/buat-campaign",
        "/campaign-saya",
        "/riwayat-donasi",
        "/pengaturan-sistem"
    ];
    const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
    if (protectedPages.includes(currentPath) && !isAuthenticated()) {
        window.location.href = "/login";
    }
};

window.openDonationModal = (id, title, currentAmount) => {
    const campaign = getCampaignById(id);

    state.currentCampaignId = id;
    const modalTitle = title || campaign?.title || "Campaign";
    const modalAmount = currentAmount || campaign?.currentAmount || 0;

    const titleEl = document.getElementById("modalCampaignTitle");
    if (titleEl) titleEl.textContent = modalTitle;

    const inputNominal = document.getElementById("inputNominal");
    if (inputNominal) inputNominal.value = "";

    state.currentCampaignCurrentAmount = modalAmount;

    const modal = document.getElementById("donationModal");
    if (!modal) return;

    modal.classList.remove("hidden");
    setTimeout(() => document.getElementById("modalContent")?.classList.remove("scale-95"), 10);
};

window.closeDonationModal = () => {
    const content = document.getElementById("modalContent");
    if (content) content.classList.add("scale-95");

    const modal = document.getElementById("donationModal");
    if (modal) {
        setTimeout(() => modal.classList.add("hidden"), 200);
    }
};

window.setNominal = (amount) => {
    const inputNominal = document.getElementById("inputNominal");
    if (inputNominal) inputNominal.value = amount;
};

let qrisPollInterval = null;
let currentQrisOrderId = null;

window.openQrisPaymentModal = (transaction, campaignTitle) => {
    currentQrisOrderId = transaction.orderId;
    
    const amountEl = document.getElementById("qrisModalAmount");
    if (amountEl) amountEl.textContent = formatRupiah(transaction.amount);

    const campaignEl = document.getElementById("qrisModalCampaign");
    if (campaignEl) campaignEl.textContent = campaignTitle || "Pembayaran Donasi";

    const imageEl = document.getElementById("qrisModalImage");
    if (imageEl) {
        document.getElementById("qrisModalLoader").classList.remove("hidden");
        imageEl.src = transaction.qrImage || transaction.paymentUrl;
    }

    const demoBadge = document.getElementById("qrisDemoBadge");
    const demoBtn = document.getElementById("qrisDemoBtn");

    if (transaction.demoMode) {
        if (demoBadge) demoBadge.classList.remove("hidden");
        if (demoBtn) demoBtn.classList.remove("hidden");
    } else {
        if (demoBadge) demoBadge.classList.add("hidden");
        if (demoBtn) demoBtn.classList.add("hidden");
    }

    const modal = document.getElementById("qrisPaymentModal");
    if (modal) {
        modal.classList.remove("hidden");
        setTimeout(() => document.getElementById("qrisModalContent")?.classList.remove("scale-95"), 10);
    }

    // Start polling
    startQrisPolling(transaction.orderId, transaction.amount);
};

window.closeQrisPaymentModal = () => {
    stopQrisPolling();
    const content = document.getElementById("qrisModalContent");
    if (content) content.classList.add("scale-95");

    const modal = document.getElementById("qrisPaymentModal");
    if (modal) {
        setTimeout(() => modal.classList.add("hidden"), 200);
    }
};

const startQrisPolling = (orderId, amount) => {
    stopQrisPolling();
    qrisPollInterval = setInterval(async () => {
        try {
            const res = await fetchJson(`/api/transactions/${orderId}/check`);
            if (res.status === "completed") {
                stopQrisPolling();
                closeQrisPaymentModal();

                showAlert(
                    "Donasi Berhasil!",
                    `Terima kasih! Donasi Anda sebesar ${formatRupiah(amount)} berhasil terverifikasi.`,
                    "success"
                );

                // Update UI state
                if (res.stats) {
                    updateStatsUI(res.stats);
                    if (res.stats.chart) setChartData(res.stats.chart);
                    if (Array.isArray(res.stats.recentDonations)) {
                        const list = document.getElementById("recent-transactions-list");
                        if (list) list.innerHTML = "";
                        res.stats.recentDonations.forEach(addRecentTransaction);
                    }
                }

                // Reload campaigns to update progress
                loadCampaigns();
            }
        } catch (err) {
            console.error("Error polling transaction:", err.message);
        }
    }, 3000);
};

const stopQrisPolling = () => {
    if (qrisPollInterval) {
        clearInterval(qrisPollInterval);
        qrisPollInterval = null;
    }
};

window.simulateQrisSuccess = async () => {
    if (!currentQrisOrderId) return;
    try {
        await fetchJson(`/api/transactions/${currentQrisOrderId}/check?simulateSuccess=true`);
    } catch (err) {
        showAlert("Gagal", "Gagal mensimulasikan pembayaran.", "error");
    }
};

window.processDonation = async () => {
    if (!isAuthenticated()) {
        showAlert("Oops!", "Silakan login untuk melakukan donasi.", "warning");
        window.location.href = "/login";
        return;
    }
    const amountValue = parseInt(document.getElementById("inputNominal")?.value, 10);
    const method = document.getElementById("paymentMethod")?.value || "qris";

    if (!amountValue || amountValue < 10000) {
        showAlert("Oops!", "Minimal donasi adalah Rp 10.000", "warning");
        return;
    }

    if (!state.currentCampaignId) {
        showAlert("Oops!", "Campaign tidak ditemukan.", "warning");
        return;
    }

    const campaign = getCampaignById(state.currentCampaignId);
    const campaignTitle = campaign ? campaign.title : "Pembayaran Donasi";

    closeDonationModal();

    if (window.Swal) {
        Swal.fire({
            title: "Menyiapkan Pembayaran...",
            text: "Mohon tunggu sebentar...",
            allowOutsideClick: false,
            showConfirmButton: false,
            didOpen: () => Swal.showLoading()
        });
    }

    try {
        const donorName = getCurrentUser()?.name || "Hamba Allah";
        const payload = await fetchJson("/api/donations", {
            method: "POST",
            body: JSON.stringify({
                campaignId: state.currentCampaignId,
                amount: amountValue,
                method,
                donorName
            })
        });

        if (window.Swal) Swal.close();

        if (payload.transaction) {
            openQrisPaymentModal(payload.transaction, campaignTitle);
        } else {
            showAlert("Gagal", "Gagal memproses transaksi.", "error");
        }
    } catch (error) {
        if (window.Swal) Swal.close();
        showAlert("Gagal", error.message || "Terjadi kesalahan.", "error");
    }
};

const loadAnalytics = async () => {
    const statsEl = document.getElementById("stat-total-dana");
    if (!statsEl) return;

    if (!isAuthenticated()) return;

    try {
        const stats = await fetchJson("/api/analytics");
        updateStatsUI(stats);
        if (stats.chart) setChartData(stats.chart);

        if (Array.isArray(stats.recentDonations)) {
            const list = document.getElementById("recent-transactions-list");
            if (list) list.innerHTML = "";
            stats.recentDonations.forEach(addRecentTransaction);
        }
    } catch (error) {
        // Fallback silently if server not available.
    }
};

const loadCampaigns = async () => {
    const grid = document.getElementById("campaignGrid");
    if (!grid && !document.getElementById("campaignTitle")) return;

    try {
        const campaigns = await fetchJson("/api/campaigns");
        state.campaigns = Array.isArray(campaigns) ? campaigns : [];
        if (grid) {
            renderCampaignGrid();
        } else {
            initCampaignDetail();
        }
    } catch (error) {
        // Fallback silently if server not available.
    }
};

const loadMyCampaigns = async () => {
    const grid = document.getElementById("myCampaignGrid");
    if (!grid) return;

    if (!isAuthenticated()) return;

    try {
        const payload = await fetchJson("/api/my-campaigns");
        const campaigns = Array.isArray(payload.campaigns) ? payload.campaigns : [];
        const stats = payload.stats || {};

        const totalEl = document.getElementById("my-campaign-total");
        const danaEl = document.getElementById("my-campaign-dana");
        const donaturEl = document.getElementById("my-campaign-donatur");
        if (totalEl) totalEl.textContent = (stats.totalCampaigns || 0).toString();
        if (danaEl) danaEl.textContent = formatRupiah(stats.totalDana || 0);
        if (donaturEl) donaturEl.textContent = (stats.totalDonatur || 0).toLocaleString("id-ID");

        if (campaigns.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
                    <i class="ph ph-megaphone text-4xl text-slate-300 mb-2"></i>
                    <p class="text-slate-500 font-medium">Belum ada campaign yang Anda buat.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = campaigns.map((campaign) => {
            const progress = campaign.targetAmount
                ? Math.min((campaign.currentAmount / campaign.targetAmount) * 100, 100)
                : 0;

            return `
                <div class="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm flex flex-col">
                    <a href="/campaign/${campaign.id}" class="h-40 bg-slate-200 block">
                        <img src="${campaign.imageUrl || 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=600&auto=format&fit=crop'}" class="w-full h-full object-cover">
                    </a>
                    <div class="p-4 flex-1 flex flex-col">
                        <p class="text-xs font-semibold text-primary-600 uppercase tracking-wider mb-2">${escapeHtml(campaign.category || 'Campaign')}</p>
                        <a href="/campaign/${campaign.id}" class="text-base font-bold text-slate-900 mb-2 hover:text-primary-600">${escapeHtml(campaign.title || 'Campaign')}</a>
                        <div class="mt-auto">
                            <div class="w-full bg-slate-100 rounded-full h-2 mb-3 overflow-hidden">
                                <div class="bg-primary-500 h-2 rounded-full" style="width: ${progress}%"></div>
                            </div>
                            <div class="flex justify-between text-sm text-slate-600 mb-2">
                                <span>${formatRupiah(campaign.currentAmount || 0)}</span>
                                <span>Target ${formatRupiah(campaign.targetAmount || 0)}</span>
                            </div>
                            <div class="flex items-center justify-between text-xs text-slate-500">
                                <span>${(campaign.donorsCount || 0).toLocaleString("id-ID")} donatur</span>
                                <span>Deadline ${campaign.deadline ? new Date(campaign.deadline).toLocaleDateString("id-ID") : '-'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    } catch (error) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
                <i class="ph ph-warning-circle text-4xl text-amber-400 mb-2"></i>
                <p class="text-slate-500 font-medium">Gagal memuat campaign Anda.</p>
            </div>
        `;
    }
};

const loadDonationHistory = async () => {
    const list = document.getElementById("donationHistoryList");
    if (!list) return;

    if (!isAuthenticated()) return;

    try {
        const payload = await fetchJson("/api/my-donations");
        const donations = Array.isArray(payload.donations) ? payload.donations : [];
        const stats = payload.stats || {};

        const totalEl = document.getElementById("donation-total");
        const countEl = document.getElementById("donation-count");
        const campaignsEl = document.getElementById("donation-campaigns");
        if (totalEl) totalEl.textContent = formatRupiah(stats.totalDonasi || 0);
        if (countEl) countEl.textContent = (stats.totalTransaksi || 0).toString();
        if (campaignsEl) campaignsEl.textContent = (stats.uniqueCampaigns || 0).toString();

        if (donations.length === 0) {
            list.innerHTML = `
                <div class="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
                    <i class="ph ph-heart text-4xl text-slate-300 mb-2"></i>
                    <p class="text-slate-500 font-medium">Belum ada donasi yang tercatat.</p>
                </div>
            `;
            return;
        }

        list.innerHTML = donations.map((donation) => {
            return `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 rounded-2xl border border-slate-100 p-4">
                    <div class="flex items-center space-x-4">
                        <div class="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center">
                            <i class="ph ph-heart text-primary-600 text-xl"></i>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-slate-900">${escapeHtml(donation.campaignTitle || 'Campaign')}</p>
                            <p class="text-xs text-slate-500">${escapeHtml(donation.organizer || 'Penggalang Dana')}</p>
                            <p class="text-xs text-slate-400">${formatDateTime(donation.createdAt)}</p>
                        </div>
                    </div>
                    <div class="mt-3 sm:mt-0 text-right">
                        <p class="text-sm font-bold text-emerald-600">${formatRupiah(donation.amount || 0)}</p>
                        <p class="text-xs text-slate-500 uppercase">${escapeHtml(donation.method || 'QRIS')}</p>
                    </div>
                </div>
            `;
        }).join("");
    } catch (error) {
        list.innerHTML = `
            <div class="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
                <i class="ph ph-warning-circle text-4xl text-amber-400 mb-2"></i>
                <p class="text-slate-500 font-medium">Gagal memuat riwayat donasi.</p>
            </div>
        `;
    }
};

const initCampaignForm = () => {
    const form = document.getElementById("campaignForm");
    if (!form) return;

    if (!isAuthenticated()) {
        window.location.href = "/login";
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);

        const payload = {
            title: formData.get("title"),
            targetAmount: formData.get("targetAmount"),
            deadline: formData.get("deadline"),
            category: formData.get("category"),
            story: formData.get("story"),
            imageUrl: formData.get("imageUrl"),
            organizer: getCurrentUser()?.name
        };

        try {
            await fetchJson("/api/campaigns", {
                method: "POST",
                body: JSON.stringify(payload)
            });

            showAlert("Berhasil", "Campaign berhasil dibuat.", "success");
            form.reset();
            window.location.href = "/dashboard";
        } catch (error) {
            showAlert("Gagal", error.message || "Gagal membuat campaign.", "error");
        }
    });
};

const initAuthForms = () => {
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(loginForm);

            try {
                const response = await fetchJson("/api/auth/login", {
                    method: "POST",
                    body: JSON.stringify({
                        email: formData.get("email"),
                        password: formData.get("password")
                    })
                });

                if (response.user) {
                    localStorage.setItem("crowdfund_user", JSON.stringify(response.user));
                }
                window.location.href = "/dashboard";
            } catch (error) {
                showAlert("Gagal", error.message || "Login gagal.", "error");
            }
        });
    }

    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
        registerForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(registerForm);

            try {
                const response = await fetchJson("/api/auth/register", {
                    method: "POST",
                    body: JSON.stringify({
                        name: formData.get("name"),
                        email: formData.get("email"),
                        password: formData.get("password")
                    })
                });

                if (response.user) {
                    localStorage.setItem("crowdfund_user", JSON.stringify(response.user));
                }
                window.location.href = "/dashboard";
            } catch (error) {
                showAlert("Gagal", error.message || "Registrasi gagal.", "error");
            }
        });
    }
};

const initSettingsForms = () => {
    const profileForm = document.getElementById("profileForm");
    if (profileForm) {
        profileForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const name = document.getElementById("profileName")?.value.trim();
            const phone = document.getElementById("profilePhone")?.value.trim();

            if (!name) {
                showAlert("Oops!", "Nama lengkap wajib diisi.", "warning");
                return;
            }

            try {
                const response = await fetchJson("/api/settings/profile", {
                    method: "PATCH",
                    body: JSON.stringify({ name, phone })
                });

                if (response.user) {
                    updateLocalUser(response.user);
                }

                showAlert("Berhasil", "Profil berhasil diperbarui.", "success");
            } catch (error) {
                showAlert("Gagal", error.message || "Gagal memperbarui profil.", "error");
            }
        });
    }

    const notificationForm = document.getElementById("notificationForm");
    if (notificationForm) {
        notificationForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const donation = Boolean(document.getElementById("notifyDonation")?.checked);
            const campaign = Boolean(document.getElementById("notifyCampaign")?.checked);
            const newsletter = Boolean(document.getElementById("notifyNewsletter")?.checked);

            try {
                const response = await fetchJson("/api/settings/notifications", {
                    method: "PATCH",
                    body: JSON.stringify({ donation, campaign, newsletter })
                });

                if (response.user) {
                    updateLocalUser(response.user);
                }

                showAlert("Berhasil", "Preferensi notifikasi tersimpan.", "success");
            } catch (error) {
                showAlert("Gagal", error.message || "Gagal menyimpan preferensi.", "error");
            }
        });
    }

    const securityForm = document.getElementById("securityForm");
    if (securityForm) {
        securityForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const newPassword = document.getElementById("newPassword")?.value || "";
            const confirmPassword = document.getElementById("confirmPassword")?.value || "";

            if (!newPassword || newPassword.length < 6) {
                showAlert("Oops!", "Password minimal 6 karakter.", "warning");
                return;
            }

            if (newPassword !== confirmPassword) {
                showAlert("Oops!", "Konfirmasi password tidak cocok.", "warning");
                return;
            }

            try {
                await fetchJson("/api/settings/security", {
                    method: "PATCH",
                    body: JSON.stringify({ newPassword, confirmPassword })
                });

                const newPasswordInput = document.getElementById("newPassword");
                const confirmPasswordInput = document.getElementById("confirmPassword");
                if (newPasswordInput) newPasswordInput.value = "";
                if (confirmPasswordInput) confirmPasswordInput.value = "";

                showAlert("Berhasil", "Password berhasil diperbarui.", "success");
            } catch (error) {
                showAlert("Gagal", error.message || "Gagal memperbarui password.", "error");
            }
        });
    }
};

const initCampaignDetail = async () => {
    const titleEl = document.getElementById("campaignTitle");
    if (!titleEl) return;

    const params = new URLSearchParams(window.location.search);
    let campaignId = params.get("id");
    if (!campaignId) {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts[0] === "campaign" && parts[1]) {
            campaignId = parts[1];
        }
    }
    if (!campaignId) return;

    try {
        const campaign = await fetchJson(`/api/campaigns/${campaignId}`);

        const breadcrumbEl = document.getElementById("campaignBreadcrumb");
        const imageEl = document.getElementById("campaignImage");
        const storyEl = document.getElementById("campaignStory");
        const raisedEl = document.getElementById("campaignRaised");
        const targetEl = document.getElementById("campaignTarget");
        const progressEl = document.getElementById("campaignProgress");
        const donorsEl = document.getElementById("campaignDonors");
        const daysLeftEl = document.getElementById("campaignDaysLeft");
        const organizerEl = document.getElementById("campaignOrganizer");

        if (breadcrumbEl) breadcrumbEl.textContent = campaign.title;
        titleEl.textContent = campaign.title;
        if (imageEl && campaign.imageUrl) imageEl.src = campaign.imageUrl;
        if (raisedEl) raisedEl.textContent = formatRupiah(campaign.currentAmount || 0);
        if (targetEl) targetEl.textContent = formatRupiah(campaign.targetAmount || 0);
        if (organizerEl) organizerEl.textContent = campaign.organizer || "Penggalang Dana";

        const progress = campaign.targetAmount
            ? (campaign.currentAmount / campaign.targetAmount) * 100
            : 0;
        if (progressEl) progressEl.style.width = `${Math.min(progress, 100)}%`;

        if (storyEl) {
            const paragraphs = (campaign.story || "").split("\n").filter(Boolean);
            storyEl.innerHTML = paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
        }

        if (donorsEl) donorsEl.textContent = "--";
        if (daysLeftEl && campaign.deadline) {
            const diff = Math.ceil((new Date(campaign.deadline) - new Date()) / (1000 * 60 * 60 * 24));
            daysLeftEl.textContent = diff > 0 ? diff.toString() : "0";
        }
    } catch (error) {
        // Ignore detail errors for now.
    }
};

const initRealtime = () => {
    if (!window.io) return;
    const list = document.getElementById("recent-transactions-list");
    if (!list) return;

    if (!isAuthenticated()) return;

    const socket = window.io();
    socket.on("donation:new", (payload) => {
        if (payload.stats) {
            updateStatsUI(payload.stats);
            if (payload.stats.chart) setChartData(payload.stats.chart);
        }

        if (payload.campaign) {
            const index = state.campaigns.findIndex((item) => item.id === payload.campaign.id);
            if (index !== -1) state.campaigns[index] = payload.campaign;
            syncCampaignCards();
        }

        if (payload.donation) {
            addRecentTransaction(payload.donation);
        }
    });
};

document.addEventListener("DOMContentLoaded", () => {
    guardProtectedRoutes();
    initChart();
    loadAnalytics();
    loadCampaigns();
    loadMyCampaigns();
    loadDonationHistory();
    syncDonationButtons();
    initCampaignForm();
    initAuthForms();
    initSettingsForms();
    initCampaignDetail();
    initRealtime();
});
