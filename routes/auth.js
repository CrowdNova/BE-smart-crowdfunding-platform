const express = require("express");

const createAuthRouter = ({ passport, ensureGoogleOAuth }) => {
    const router = express.Router();

    router.get("/auth/google", ensureGoogleOAuth, passport.authenticate("google", {
        scope: ["profile", "email"]
    }));

    router.get(
        "/auth/google/callback",
        ensureGoogleOAuth,
        passport.authenticate("google", {
            session: false,
            failureRedirect: "/login"
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
        window.location.href = "/dashboard";
    </script>
</body>
</html>`);
        }
    );

    router.get("/logout", (req, res) => {
        res.clearCookie("auth_user", { sameSite: "lax" });
        res.set("Content-Type", "text/html");
        res.send(`<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Logout</title>
</head>
<body>
    <script>
        localStorage.removeItem("crowdfund_user");
        window.location.href = "/login";
    </script>
</body>
</html>`);
    });

    return router;
};

module.exports = createAuthRouter;
