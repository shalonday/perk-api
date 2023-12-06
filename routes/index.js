var express = require("express");
var router = express.Router();

const neo4jService = require("../services/neo4j");

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Express" });
});

router.get("/tree", neo4jService.readUniversalTree);
router.get("/search/:query", neo4jService.searchNodes);
//router.get("/pathStart/:startNode/pathEnd/:endNode", neo4jService.readPath);

router.post("/tree", neo4jService.mergeTree);

module.exports = router;
