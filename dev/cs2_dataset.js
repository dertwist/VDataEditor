// Node.js script: print JSON structure as a tree
// Usage: node print-json-structure.js schemas/cs2.json

const fs = require("fs");
const path = require("path");


const inputPath = "schemas/cs2.json";
const fullPath = path.resolve(process.cwd(), inputPath);

function getType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (Number.isInteger(value)) return "integer";
  return typeof value; // object, string, number, boolean, undefined, function
}

function walk(value, indent = "") {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      console.log(`${indent}[]: empty`);
      return;
    }
    const sample = value[0];
    console.log(`${indent}[0]: ${getType(sample)}`);
    walk(sample, indent + "  ");
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      console.log(`${indent}${key}: ${getType(child)}`);
      walk(child, indent + "  ");
    }
  }
}

try {
  const raw = fs.readFileSync(fullPath, "utf8");
  const data = JSON.parse(raw);
  walk(data);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}