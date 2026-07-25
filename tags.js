function extractTags(content) {
  const matches = content.match(/#(\w+)/g) || [];
  const seen = new Set();
  const tags = [];
  for (const match of matches) {
    const tag = match.slice(1);
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

module.exports = { extractTags };
