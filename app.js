require("dotenv").config();

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
const { isAllowedDomain } = require("./services/ingest/scraperConfig");
const { scrapeContent } = require("./services/ingest/scraper");

app.use(
  cors({
    origin: true,
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

app.get("/tree", neo4jService.readUniversalTree);
app.get("/paths/:startNodeId/:targetNodeId", neo4jService.readPath);
app.get(
  "/shortestPath/:startNodeId/:targetNodeId",
  neo4jService.readShortestPath,
);

// Chatbot endpoints
app.post("/chatbot/chat", neo4jService.chatbotChat);
app.post("/chatbot/search", neo4jService.chatbotSearch);
app.post("/chatbot/material-request", neo4jService.chatbotMaterialRequest);

app.post("/ingest/analyze", async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "Please provide a valid URL." });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "Please provide a valid URL." });
  }

  if (
    !parsedUrl.protocol ||
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname
  ) {
    return res.status(400).json({ error: "Please provide a valid HTTPS URL." });
  }

  if (!isAllowedDomain(parsedUrl.hostname)) {
    return res.status(400).json({
      error:
        "URL domain is not allowed for ingestion. Please use one of the approved learning sites.",
    });
  }

  try {
    const pageData = await scrapeContent(parsedUrl.toString());
    console.log("Scraped page data:", pageData);
    return res.status(200).json({
      url: parsedUrl.toString(),
      title: pageData.title,
      content: pageData.content,
      prerequisites: [],
      objectives: [],
    });
  } catch (error) {
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Unable to load the page for ingestion.",
    });
  }
});

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
