var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const RateLimit = require("express-rate-limit");

var app = express();

app.use(compression());
app.use(helmet());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const neo4jService = require("./services/service");

app.get("/tree", cors(), neo4jService.readUniversalTree);
app.get("/search/:query", cors(), neo4jService.searchNodes);
app.get("/nodes/:idsString", cors(), neo4jService.getNodesById); //a string of UUIDs separated by ,
app.get(
  "/pathStart/:startNode/pathEnd/:endNode",
  cors(),
  neo4jService.readPath
);

app.post(
  "/tree",
  cors({ origin: "https://shalonday.github.io" }),
  neo4jService.mergeTree
);

app.post(
  "/user",
  cors({ origin: "https://www.webbrainproject.org" }),
  neo4jService.createUser
);

app.set('trust proxy', 1);

// Set up rate limiter: maximum of twenty requests per minute
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
});
// Apply rate limiter to all requests
app.use(limiter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
