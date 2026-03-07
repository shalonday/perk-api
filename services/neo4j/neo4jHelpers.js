/**
 * Neo4j helper utilities for the Web Brain Project.
 * Handles construction of Cypher queries and Neo4j data transformations.
 */

/**
 * Build a query for matching nodes by ID.
 */
function buildQueryForMatchingNodesById(array) {
  let queryString = "";
  let returnString = "RETURN";

  for (let i = 0; i < array.length; i++) {
    queryString += `MATCH (n_${i} {id: "${array[i]}"}) `;
    if (i < array.length - 1) returnString += ` n_${i},`;
    else returnString += ` n_${i}`;
  }

  queryString += returnString;
  console.log(queryString);
  return queryString;
}

/**
 * Convert Neo4j relationship to D3-compatible link format.
 * Since I do not save source and target UUIDs into the relationships in the tree (for some reason I forgot)
 * I need to find the corresponding source and target uuid's for each relationship using their neo4j internal
 * "start" and "end" properties and comparing that with the neo4j internal "identity" properties of the nodes
 * and grabbing the matching node's id property corresponding to the UUID that I specified.
 */
function getD3CompatibleLink(link, nodesWithInternalData) {
  const startNodeInternalId = link.start.toString();
  const endNodeInternalId = link.end.toString();
  let mySourceUuid; // the corresponding source node's uuid which was set by me.
  let myTargetUuid;

  // iterate through the nodes to find the source and target
  nodesWithInternalData.forEach((node) => {
    if (node.identity.toString() === startNodeInternalId) {
      mySourceUuid = node.properties.id;
    }
    if (node.identity.toString() === endNodeInternalId) {
      myTargetUuid = node.properties.id;
    }
  });

  const rel = {
    id: link.properties.id,
    source: mySourceUuid,
    target: myTargetUuid,
  };
  return rel;
}

module.exports = {
  buildQueryForMatchingNodesById,
  getD3CompatibleLink,
};
