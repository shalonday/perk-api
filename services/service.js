const neo4j = require("neo4j-driver");
require("dotenv").config();

let driver;

async function initDriver() {
  try {
    driver = await neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
    );
    await driver.verifyAuthentication;
    console.log("connection to server established");
  } catch (err) {
    console.error(err);
  }
}

initDriver();

async function mergeTree(req, res, next) {
  const session = driver.session();
  const tree = req.body;
  const nodesArray = tree.nodes;
  const linksArray = tree.links;
  const query = buildMergeQuery(nodesArray, linksArray);

  const { summary } = await session.executeWrite((tx) => {
    return tx.run(query);
  });
  console.log("Finished transaction: " + summary.counters._stats);
  res.json(summary.counters._stats);
  session.close();
  console.log("session closed");
}

// Execute transactions one by one to declare necessary variables one by one
async function readUniversalTree(req, res, next) {
  const session = driver.session();

  const getSkillsTransaction = await session.executeRead((tx) => {
    return tx.run("MATCH (s:Skill) RETURN s");
  });

  const skills = getSkillsTransaction.records.map(
    (record) => record.get("s").properties,
  );
  skills.map((skill) => (skill.type = "skill"));

  const getURLsTransaction = await session.executeRead((tx) => {
    return tx.run("MATCH (u:URL) RETURN u");
  });

  const urls = getURLsTransaction.records.map(
    (record) => record.get("u").properties,
  );
  urls.map((url) => (url.type = "url"));

  const getPrerequisiteLinksTransaction = await session.executeRead((tx) => {
    return tx.run(
      "MATCH (s:Skill)-[r:IS_PREREQUISITE_TO]->(u:URL) RETURN s,r,u",
    );
  });

  let prereqLinks = getPrerequisiteLinksTransaction.records.map((record) => {
    const link = {
      uuid: record.get("r").properties.uuid,
      source: record.get("s").properties.uuid,
      target: record.get("u").properties.uuid,
    };

    return link;
  });

  const getTeachesLinksTransaction = await session.executeRead((tx) => {
    return tx.run("MATCH (u:URL)-[r:TEACHES]->(s:Skill) RETURN u,r,s");
  });

  let teachesLinks = getTeachesLinksTransaction.records.map((record) => {
    const link = {
      uuid: record.get("r").properties.uuid,
      source: record.get("u").properties.uuid,
      target: record.get("s").properties.uuid,
    };

    return link;
  });

  const nodes = urls.concat(skills);
  const links = prereqLinks.concat(teachesLinks);
  res.json({ nodes, links });

  session.close();
  console.log("session closed at read");
}

// Search skills and modules (not resources just yet; maybe in future) for given query.
// All searches executed on the tree can only return nodes, not relationships,
// since relationships don't have properties.
async function searchNodes(req, res, next) {
  const query = req.params.query;
  const session = driver.session();

  const skillNodeResults = await session.executeRead((tx) => {
    return tx.run(
      `MATCH (s:Skill) where toLower(s.title) CONTAINS "${query.toLowerCase()}" OR toLower(s.description) CONTAINS "${query.toLowerCase()}" RETURN s`,
    );
  });

  const moduleNodeResults = await session.executeRead((tx) => {
    return tx.run(
      `MATCH (m:Module) where toLower(m.title) CONTAINS "${query.toLowerCase()}" OR toLower(m.learnText) CONTAINS "${query.toLowerCase()}" OR toLower(m.practiceText) CONTAINS "${query.toLowerCase()}" RETURN m`,
    );
  });

  const skills = skillNodeResults.records.map(
    (record) => record.get("s").properties,
  );
  const modules = moduleNodeResults.records.map(
    //used "let" because we mutate it in the populateModulesWithResources function
    (record) => record.get("m").properties,
  );

  const nodes = skills.concat(modules);

  res.json({ nodes: nodes, links: [] });
  session.close();
}

async function getNodesById(req, res, next) {
  const idsString = req.params.idsString; // string of UUIDs separated by a comma
  const idsArray = idsString.split(",");
  const session = driver.session();

  const getNodesTx = await session.executeRead((tx) =>
    tx.run(buildQueryForMatchingNodesById(idsArray)),
  );

  const nodes = getNodesTx.records[0]?.map((val) => val.properties); // this looks a bit different than the other ones because there is only one record containing multiple return values.

  res.json({ nodes: nodes, links: [] });
}

async function readPath(req, res, next) {
  const startNodeId = req.params.startNode;
  const endNodeId = req.params.endNode;

  const session = driver.session();

  const pathTransaction = await session.executeRead((tx) => {
    return tx.run(
      `MATCH p=({uuid: "${startNodeId}"})-[*]->({uuid:"${endNodeId}"})
      WITH nodes(p) as pathNodes, relationships(p) as pathRels
      UNWIND pathNodes as n
      UNWIND pathRels as r
      WITH collect(distinct n) as distinctNodes, 
           collect({uuid: r.uuid, source: startNode(r).uuid, target: endNode(r).uuid}) as distinctLinks
      RETURN distinctNodes, distinctLinks`,
    );
  });

  const nodes = pathTransaction.records[0]
    .get("distinctNodes")
    .map((node) => node.properties);

  const links = pathTransaction.records[0].get("distinctLinks");

  res.json({
    nodes: nodes,
    links: links,
  });

  session.close();
}

// Build a neo4j query from the nodes and links
function buildMergeQuery(nodesArray, linksArray) {
  let query = "";

  if (linksArray.length > 0) {
    // For each link, build query merging a (source)-[link]->(target) record to the neo4j database.
    // The indeces i,j are important to make the variables unique throughout the whole query.
    linksArray.forEach((link, i) => {
      const sourceNode = nodesArray.filter(
        (node) => node.uuid === link.source,
      )[0];
      const targetNode = nodesArray.filter(
        (node) => node.uuid === link.target,
      )[0];
      if (sourceNode.type === "skill" && targetNode.type === "module") {
        query += buildQueryForSkillToModuleAndModuleToResourceRelationships(
          sourceNode,
          link.uuid,
          targetNode,
          i,
        );
      } else if (sourceNode.type === "module" && targetNode.type === "skill") {
        query += buildQueryForModuleToSkillRelationships(
          sourceNode,
          link.uuid,
          targetNode,
          i,
        );
      }
    });
  } else {
    // only nodes were submitted to be merged; probably updates
    nodesArray.forEach((node, i) => {
      query += buildQueryForDisconnectedNode(node, i);
    });
  }

  return query;
}

function buildQueryForSkillToModuleAndModuleToResourceRelationships(
  sourceSkillNode,
  linkId,
  targetModuleNode,
  index,
) {
  let querySegment = "";
  const { resourcesArray, ...restOfModuleNode } = targetModuleNode;
  // MERGE Skill Node and Module node to store them into variables.
  // MERGE Skill -IS_PREREQUISITE_TO-> Module records
  querySegment += `MERGE (ss${index}:Skill {${convertToPropertiesString(
    sourceSkillNode,
  )}}) MERGE (tm${index}:Module {${convertToPropertiesString(
    restOfModuleNode,
  )}}) MERGE (ss${index})-[:IS_PREREQUISITE_TO {uuid: "${linkId}"}]->(tm${index}) `; //ss for source-skill, and tm for target-module

  // MERGE Resource Nodes to get their variables
  // MERGE Module -REFERENCES-> Resource records
  // That I put this in the same query builder function as the Skill-->Module relationships instead of the other one
  // doesn't matter; I just needed some reference to the modules.
  if (targetModuleNode.resourcesArray) {
    targetModuleNode.resourcesArray.forEach((resource, j) => {
      querySegment += `MERGE (r${index}_${j}:Resource {${convertToPropertiesString(
        resource,
      )}}) MERGE (tm${index})-[:REFERENCES]->(r${index}_${j}) `;
    });
  }

  return querySegment;
}

function buildQueryForModuleToSkillRelationships(
  sourceModuleNode,
  linkId,
  targetSkillNode,
  index,
) {
  let querySegment = "";
  const { resourcesArray, ...restOfModuleNode } = sourceModuleNode;
  // MERGE Module and Skill nodes to store them into variables
  // MERGE Module -[:TEACHES]-> Skill records
  querySegment += `MERGE (sm${index}:Module {${convertToPropertiesString(
    restOfModuleNode,
  )}}) MERGE (ts${index}:Skill {${convertToPropertiesString(
    targetSkillNode,
  )}}) MERGE (sm${index})-[:TEACHES {uuid: "${linkId}"}]->(ts${index}) `;

  return querySegment;
}

function buildQueryForDisconnectedNode(node, index) {
  let querySegment = "";
  if (node.type === "skill")
    querySegment += `MERGE (:Skill {${convertToPropertiesString(node)}}) `;
  else if (node.type === "module") {
    // merge Module node and its associated Resource nodes
    querySegment += `MERGE (m${index}:Module {${convertToPropertiesString(
      node,
    )}}) `;

    node.resourcesArray?.forEach((resource, j) => {
      querySegment += `MERGE (r${index}_${j}:Resource {${convertToPropertiesString(
        resource,
      )}}) MERGE (m${index})-[:REFERENCES]->(r${index}_${j}) `;
    });
  }

  return querySegment;
}

// Object -> String
// Rewrite the object as a string without appending quotation marks on property names, but
// with marks on the property values. This makes the string acceptable as a properties object
// on a neo4j query.
function convertToPropertiesString(object) {
  const string = Object.keys(object).map(
    (key) => key + ": " + JSON.stringify(object[key]),
  );
  return string;
}

// ModulesArray, Transaction -> ModulesArray
// Using the transaction that relates resources with the modules they belong in, populate the
// resourcesArray of each module.
function populateModulesWithResources(modules, relationshipTransaction) {
  modules.forEach((module) => (module.resourcesArray = []));
  // I don't remember why I put this above line but this works because I end up saving filled up resourcesArray as a property of
  // Module objects, when these Resources are also converted to nodes. We basically have copies of resources as nodes
  // and as properties. But in this function we reset the resourcesArray property to an empty array first, so that the
  // push doesn't end up doubling the contents.
  relationshipTransaction.records.forEach((record) => {
    let matchedModule = modules.filter(
      (module) => module.id && module.id === record.get("m").properties.id,
    )[0];

    if (matchedModule)
      matchedModule.resourcesArray.push(record.get("r").properties);
  });
}

function buildQueryForMatchingNodesById(array) {
  let queryString = "";
  let returnString = "RETURN";

  for (let i = 0; i < array.length; i++) {
    queryString += `MATCH (n_${i} {uuid: "${array[i]}"}) `;
    if (i < array.length - 1) returnString += ` n_${i},`;
    else returnString += ` n_${i}`;
  }

  queryString += returnString;
  console.log(queryString);
  return queryString;
}

async function createUser(req, res, next) {
  const session = driver.session();
  const user = req.body;
  console.log(user);

  let { records, summary } = await createUniqueNodeQuery({
    label: "User",
    properties: user,
    idPropertyName: "email",
    idPropertyValue: user.email,
  });

  console.log(summary);
  console.log(records);
  res.json({ records, summary });
  session.close();
  console.log("session closed");
}

/**
 * General function for creating nodes that are supposed to be unique
 * @param {string} label - The label of the node
 * @param {object} properties - properties to be assigned to the node
 * @param {string} idPropertyName - The name of the property that identifies this particular node label as unique.
 * @param {string} idPropertyValue - The STRING value of the property with name idPropertyName
 */
async function createUniqueNodeQuery({
  label,
  properties,
  idPropertyName,
  idPropertyValue,
}) {
  // write query based on label and properties
  let { records, summary } = await driver.executeQuery(
    `
      // Check if the node already exists
      CALL apoc.util.validate(
      EXISTS { MATCH (n:${label} {${idPropertyName}: '${idPropertyValue}'}) RETURN n },
      '${label} with ${idPropertyName}: ${idPropertyValue} already exists',
      []
      )
      
      // If it doesn't exist, create it
      CREATE (n:${label})
      SET n = $properties
  `,
    { properties: properties },
  );

  return { records, summary };
}

async function createRelationship({ type, properties }) {}

module.exports = {
  mergeTree,
  readUniversalTree,
  searchNodes,
  getNodesById,
  readPath,
  createUser,
};
