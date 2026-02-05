const createError = require("http-errors");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const RateLimit = require("express-rate-limit");

const app = express();

app.use(
  cors({
    origin: "https://www.webbrainproject.org",
    methods: ["GET", "POST", "OPTIONS"],
  }),
);
app.use(compression());
app.use(helmet());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const neo4jService = require("./services/service");

app.get("/tree", cors(), neo4jService.readUniversalTree);
app.get("/paths/:startNodeId/:targetNodeId", cors(), neo4jService.readPath);

app.post(
  "/tree",
  cors({ origin: "https://shalonday.github.io" }),
  neo4jService.mergeTree,
);

// Chatbot endpoints
app.post("/chatbot/chat", cors(), neo4jService.chatbotChat);
app.post("/chatbot/search", cors(), neo4jService.chatbotSearch);
app.post(
  "/chatbot/material-request",
  cors(),
  neo4jService.chatbotMaterialRequest,
);

app.set("trust proxy", 1);

// Set up rate limiter: maximum of twenty requests per minute
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
});
// Apply rate limiter to all requests
app.use(limiter);

// catch 404 and forward to error handler
app.use((req, res, next) => {
  next(createError(404));
});

// error handler
app.use((err, req, res, next) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.json({
    error: "An internal server error occurred.",
    message: err.message,
  });
});

module.exports = app;
