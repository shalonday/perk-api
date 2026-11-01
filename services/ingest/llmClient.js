/**
 * LLM-backed extraction helpers for ingesting educational content.
 *
 * This module is intentionally separated so tests can mock the LLM boundary
 * without needing network access or model credentials.
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { InferenceClient } = require("@huggingface/inference");

const systemPrompt = readFileSync(
  join(__dirname, "prompts", "skill_extraction_system.txt"),
  "utf8",
);
const userPromptTemplate = readFileSync(
  join(__dirname, "prompts", "skill_extraction_user.txt"),
  "utf8",
);

let client;
function getHfClient() {
  if (!process.env.HF_API_KEY) {
    throw new Error("HF_API_KEY is not configured.");
  }

  client ??= new InferenceClient(process.env.HF_API_KEY);
  return client;
}

/**
 * Checks whether the given list of skills is valid (non-empty array of non-empty strings).
 * @param {string[]} items - List of skills.
 * @returns {boolean} True if the list is valid (non-empty array of non-empty strings).
 */
function hasValidList(items) {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

/**
 * Checks whether any objective skill also appears as a prerequisite, ignoring case and surrounding whitespace.
 *
 * @param {string[]} prerequisites - Prerequisite skills.
 * @param {string[]} objectives - Objective skills.
 * @returns {boolean} True if at least one skill appears in both lists.
 */
function hasOverlappingSkills(prerequisites, objectives) {
  const normalize = (skill) => skill.trim().toLowerCase();
  const prerequisiteSet = new Set(prerequisites.map(normalize));

  return objectives.some((skill) => prerequisiteSet.has(normalize(skill)));
}

/**
 * Validates that the extracted skills object has non-empty prerequisite and objective lists and no overlapping skills.
 * @param {{ prerequisites: string[], objectives: string[] }} result - The extracted skills object.
 * @returns {{ prerequisites: string[], objectives: string[] }} Validated and normalized skills object.
 */
function validateSkills(result) {
  if (
    !result ||
    !hasValidList(result.prerequisites) ||
    !hasValidList(result.objectives)
  ) {
    throw new Error("The model returned invalid prerequisite/objective lists.");
  }

  if (hasOverlappingSkills(result.prerequisites, result.objectives)) {
    throw new Error(
      "The model returned overlapping prerequisite and objective skills.",
    );
  }

  return {
    prerequisites: result.prerequisites.map((skill) => skill.trim()),
    objectives: result.objectives.map((skill) => skill.trim()),
  };
}

/**
 * Sends the main educational content to an LLM and extracts the prerequisites and learning objectives.
 *
 * @param {string} educContent - The main educational content text.
 * @param {string} [sourceTitle=""] - The title of the educational content's source page.
 * @returns {{ prerequisites: string[], objectives: string[] }} Extracted prerequisites and objectives.
 */
async function extractPrereqsAndObjectivesFromContent(
  educContent,
  sourceTitle = "",
) {
  const userPrompt = userPromptTemplate
    .replace("{{title}}", () => sourceTitle)
    .replace("{{body}}", () => educContent);

  let response;
  try {
    response = await getHfClient().chatCompletion({
      model: process.env.HF_MODEL || "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2048,
      temperature: 0,
    });
  } catch (error) {
    throw new Error("Hugging Face skill extraction request failed.", {
      cause: error,
    });
  }

  const content = response.choices?.[0]?.message?.content;
  console.log("LLM message raw:", response.choices?.[0]?.message);
  console.log("LLM response full:", response);
  console.log("LLM response content:", content);
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The model returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error("The model response was not valid JSON.", { cause: error });
  }

  console.log("parsed:", parsed);

  return validateSkills(parsed);
}

module.exports = {
  extractPrereqsAndObjectivesFromContent,
};
