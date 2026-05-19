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
    if (!window.location.pathname.endsWith("login.html")) {
        window.location.href = "login.html";
    }
};

const formatRupiah = (number) => {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0
    }).format(number);
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
        link.setAttribute("href", `detail-campaign.html?id=${campaign.id}`);
    });
};

const syncCampaignCards = () => {
    const cards = document.querySelectorAll("[data-campaign-card]");
    if (!cards.length) return;

    cards.forEach((card, index) => {
        const cardId = card.dataset.campaignId;
        const campaign = cardId ? getCampaignById(cardId) : state.campaigns[index];
        updateCampaignCard(card, campaign);
    });
};

const syncDonationButtons = () => {
    document.querySelectorAll("[data-action='donate']").forEach((button) => {
        button.addEventListener("click", () => {
            if (!isAuthenticated()) {
                showAlert("Oops!", "Silakan login untuk melakukan donasi.", "warning");
                window.location.href = "login.html";
                return;
            }
            openDonationModal(button.dataset.campaignId);
        });
    });
};

const updateStatsUI = (stats) => {
    const totalDanaEl = document.getElementById("stat-total-dana");
    const totalDonaturEl = document.getElementById("stat-total-donatur");

    if (totalDanaEl) totalDanaEl.textContent = formatRupiah(stats.totalDana || 0);
    if (totalDonaturEl) totalDonaturEl.textContent = (stats.totalDonatur || 0).toLocaleString("id-ID");
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
    const protectedPages = ["dashboard.html", "buat-campaign.html"];
    const currentPage = window.location.pathname.split("/").pop();
    if (protectedPages.includes(currentPage) && !isAuthenticated()) {
        window.location.href = "login.html";
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

window.processDonation = async () => {
    if (!isAuthenticated()) {
        showAlert("Oops!", "Silakan login untuk melakukan donasi.", "warning");
        window.location.href = "login.html";
        return;
    }
    const amountValue = parseInt(document.getElementById("inputNominal")?.value, 10);
    const method = document.getElementById("paymentMethod")?.value || "QRIS";

    if (!amountValue || amountValue < 10000) {
        showAlert("Oops!", "Minimal donasi adalah Rp 10.000", "warning");
        return;
    }

    if (!state.currentCampaignId) {
        showAlert("Oops!", "Campaign tidak ditemukan.", "warning");
        return;
    }

    closeDonationModal();

    if (window.Swal) {
        Swal.fire({
            title: "Memproses Pembayaran...",
            text: `Metode: ${method}`,
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

        const paymentUrl = payload.transaction?.paymentUrl;
        if (paymentUrl && window.Swal) {
            Swal.fire({
                title: "Lanjutkan Pembayaran",
                html: `<a href="${paymentUrl}" target="_blank" rel="noopener">Buka link pembayaran</a>`,
                icon: "info",
                confirmButtonText: "Tutup"
            });
        } else if (paymentUrl) {
            showAlert("Lanjutkan Pembayaran", `Buka link: ${paymentUrl}`, "info");
        } else {
            showToast("Berhasil!", `Donasi ${formatRupiah(amountValue)} diterima.`);
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
    const cards = document.querySelectorAll("[data-campaign-card]");
    if (!cards.length && !document.getElementById("campaignTitle")) return;

    try {
        const campaigns = await fetchJson("/api/campaigns");
        state.campaigns = Array.isArray(campaigns) ? campaigns : [];
        syncCampaignCards();
    } catch (error) {
        // Fallback silently if server not available.
    }
};

const initCampaignForm = () => {
    const form = document.getElementById("campaignForm");
    if (!form) return;

    if (!isAuthenticated()) {
        window.location.href = "login.html";
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
            window.location.href = "dashboard.html";
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
                window.location.href = "dashboard.html";
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
                window.location.href = "dashboard.html";
            } catch (error) {
                showAlert("Gagal", error.message || "Registrasi gagal.", "error");
            }
        });
    }
};

const initCampaignDetail = async () => {
    const titleEl = document.getElementById("campaignTitle");
    if (!titleEl) return;

    const params = new URLSearchParams(window.location.search);
    const campaignId = params.get("id");
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
        const currentUser = getCurrentUser();
        if (payload.userId && currentUser?.id && payload.userId !== currentUser.id) {
            return;
        }
        if (payload.stats) {
            updateStatsUI(payload.stats);
            if (payload.stats.chart) setChartData(payload.stats.chart);
        }

        if (payload.campaign) {
            const index = state.campaigns.findIndex((item) => item.id === payload.campaign.id);
            if (index !== -1) state.campaigns[index] = payload.campaign;
            syncCampaignCards();
        }

        if (payload.donation) addRecentTransaction(payload.donation);
    });
};

document.addEventListener("DOMContentLoaded", () => {
    guardProtectedRoutes();
    initChart();
    loadAnalytics();
    loadCampaigns();
    syncDonationButtons();
    initCampaignForm();
    initAuthForms();
    initCampaignDetail();
    initRealtime();
});
