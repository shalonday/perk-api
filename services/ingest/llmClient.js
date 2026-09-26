/**
 * LLM-backed extraction helpers for ingesting educational content.
 *
 * This module is intentionally separated so tests can mock the LLM boundary
 * without needing network access or model credentials.
 */

/**
 * Sends the main educational content to an LLM and extracts the prerequisites and learning objectives.
 *
 * @param {string} educContent - The main educational content text.
 * @returns {{ prerequisites: string[], objectives: string[] }} Extracted prerequisites and objectives.
 */
function extractPrereqsAndObjectivesFromContent(educContent) {
  // TODO

  // send educContent along with a prompt to the LLM to extract prerequisites and objectives
  // ensure prompt requests a specific structured reply:
  // {
  //   "prerequisites": ["prereq1", "prereq2", ...],
  //   "objectives": ["objective1", "objective2", ...]
  // }
  void educContent;

  return {
    prerequisites: [],
    objectives: [],
  };
}

module.exports = {
  extractPrereqsAndObjectivesFromContent,
};
