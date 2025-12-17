// Test script for location detection improvements
// Run with: node test-location-detection.js

// Test 1: Regex escaping
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

console.log("=== Test 1: Regex Escaping ===");
const testCases = [
    "St. Petersburg",
    "New York",
    "Black Sea",
    "Test (with parentheses)",
    "Test [with brackets]"
];

testCases.forEach(term => {
    const escaped = escapeRegex(term);
    console.log(`Original: "${term}"`);
    console.log(`Escaped:  "${escaped}"`);
    try {
        new RegExp(escaped);
        console.log("✓ Valid regex\n");
    } catch (e) {
        console.log("✗ Invalid regex:", e.message, "\n");
    }
});

// Test 2: Flexible pattern matching
function createFlexiblePattern(term) {
    const escaped = escapeRegex(term);
    const flexible = escaped.replace(/\s+/g, '[\\s\\-]+');
    return new RegExp("\\b" + flexible + "\\b", "gi");
}

console.log("=== Test 2: Multi-word Matching ===");
const text = `The Ottoman Empire controlled Constantinople and the Black Sea.
The Black-Sea region was important. BlackSea (no space) should not match.
New York City was far away. NewYork (no space) should not match.`;

const searches = ["Black Sea", "Constantinople", "New York"];
searches.forEach(term => {
    const pattern = createFlexiblePattern(term);
    const matches = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
        matches.push(match[0]);
    }
    console.log(`Searching for "${term}":`);
    console.log(`Found: ${matches.length} match(es) - ${matches.join(", ")}`);
    console.log();
});

// Test 3: Longest match priority
console.log("=== Test 3: Longest Match Priority ===");
const locations = ["York", "New York", "New York City", "Black", "Black Sea"];
const testText = "We visited New York City and sailed the Black Sea.";

const allMatches = [];
locations.forEach(loc => {
    const pattern = createFlexiblePattern(loc);
    let match;
    while ((match = pattern.exec(testText)) !== null) {
        allMatches.push({
            name: loc,
            text: match[0],
            index: match.index,
            length: match[0].length
        });
    }
});

console.log("All matches (before sorting):");
allMatches.forEach(m => console.log(`  "${m.name}" at index ${m.index}, length ${m.length}`));

allMatches.sort((a, b) => b.length - a.length);

console.log("\nAll matches (after sorting by length):");
allMatches.forEach(m => console.log(`  "${m.name}" at index ${m.index}, length ${m.length}`));

// Simulate overlap detection
const usedRanges = [];
const finalMatches = [];

for (const match of allMatches) {
    const matchEnd = match.index + match.length;
    const overlaps = usedRanges.some(([start, end]) => {
        return (match.index >= start && match.index < end) ||
               (matchEnd > start && matchEnd <= end) ||
               (match.index <= start && matchEnd >= end);
    });

    if (!overlaps) {
        usedRanges.push([match.index, matchEnd]);
        finalMatches.push(match);
    }
}

console.log("\nFinal matches (after overlap removal):");
finalMatches.forEach(m => console.log(`  ✓ "${m.name}" - matched "${m.text}"`));

// Test 4: Confidence scoring simulation
console.log("\n=== Test 4: Confidence Scoring ===");
const disambiguationRules = {
    "Georgia": {
        caucasus: { keywords: ["Ottoman", "Russia", "Caucasus", "Tbilisi"], coords: [41.7151, 44.8271] },
        us: { keywords: ["Atlanta", "Confederate", "Sherman", "Civil War"], coords: [32.1656, -82.9001] }
    }
};

function calculateConfidence(name, text, matchIndex, matchLength) {
    const rules = disambiguationRules[name];
    if (!rules) return 1.0;

    const contextStart = Math.max(0, matchIndex - 200);
    const contextEnd = Math.min(text.length, matchIndex + matchLength + 200);
    const context = text.slice(contextStart, contextEnd).toLowerCase();

    let bestScore = 0;
    let totalKeywords = 0;

    for (const rule of Object.values(rules)) {
        const keywordCount = rule.keywords.length;
        totalKeywords = Math.max(totalKeywords, keywordCount);
        const matches = rule.keywords.filter(kw => context.includes(kw.toLowerCase())).length;
        bestScore = Math.max(bestScore, matches);
    }

    if (bestScore > 0) {
        return Math.min(1.0, 0.5 + (bestScore / totalKeywords));
    }

    return 0.3;
}

const testTexts = [
    "The Ottoman Empire expanded into Georgia near the Caucasus mountains.",
    "Sherman's march through Georgia devastated Confederate forces.",
    "Georgia is an important location."
];

testTexts.forEach((txt, i) => {
    const idx = txt.indexOf("Georgia");
    const confidence = calculateConfidence("Georgia", txt, idx, "Georgia".length);
    console.log(`Text ${i + 1}: "${txt}"`);
    console.log(`Confidence: ${(confidence * 100).toFixed(0)}%`);
    console.log(`Status: ${confidence >= 0.5 ? "✓ High confidence" : "⚠ Needs review"}\n`);
});

console.log("=== All Tests Complete ===");
