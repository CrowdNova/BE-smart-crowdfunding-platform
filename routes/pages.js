const express = require("express");

const createPagesRouter = ({ getAuthUser, requirePageAuth }) => {
    const router = express.Router();

    router.use(async (req, res, next) => {
        try {
            res.locals.currentUser = await getAuthUser(req);
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/", (req, res) => {
        res.render("index");
    });

    router.get("/login", (req, res) => {
        if (res.locals.currentUser) {
            res.redirect("/dashboard");
            return;
        }
        res.render("login");
    });

    router.get("/register", (req, res) => {
        if (res.locals.currentUser) {
            res.redirect("/dashboard");
            return;
        }
        res.render("register");
    });

    router.get("/dashboard", requirePageAuth, (req, res) => {
        res.render("dashboard", { activePage: "dashboard" });
    });

    router.get("/buat-campaign", requirePageAuth, (req, res) => {
        res.render("buat-campaign", { activePage: "buat-campaign" });
    });

    router.get("/campaign/:id", (req, res) => {
        res.render("detail-campaign");
    });

    return router;
};

module.exports = createPagesRouter;
