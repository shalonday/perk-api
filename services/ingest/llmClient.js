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
  void educContent;

  return {
    prerequisites: [],
    objectives: [],
  };
}

module.exports = {
  extractPrereqsAndObjectivesFromContent,
};
