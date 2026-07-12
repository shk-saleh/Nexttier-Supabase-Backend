const TECH_KEYWORDS = [
  "computer science",
  "software engineering",
  "software development",
  "programming",
  "coding",
  "developer",
  "full stack",
  "frontend",
  "front-end",
  "backend",
  "back-end",
  "web development",
  "mobile development",
  "android",
  "ios",
  "react",
  "react native",
  "next.js",
  "nextjs",
  "vue",
  "angular",
  "svelte",
  "node.js",
  "nodejs",
  "express",
  "django",
  "flask",
  "fastapi",
  "spring",
  "spring boot",
  "laravel",
  "ruby on rails",
  "flutter",
  "kotlin",
  "swift",
  "typescript",
  "javascript",
  "python",
  "java",
  "c++",
  "c#",
  "go",
  "rust",
  "sql",
  "database",
  "dbms",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "data science",
  "data analytics",
  "data engineering",
  "etl",
  "power bi",
  "tableau",
  "pandas",
  "numpy",
  "pytorch",
  "tensorflow",
  "machine learning",
  "deep learning",
  "artificial intelligence",
  "ai",
  "ml",
  "prompt engineering",
  "cybersecurity",
  "security",
  "networking",
  "cloud",
  "devops",
  "docker",
  "kubernetes",
  "aws",
  "azure",
  "gcp",
  "api",
  "rest",
  "graphql",
  "system design",
  "operating system",
  "algorithms",
  "data structures",
  "recursion",
  "inheritance",
  "polymorphism",
  "encapsulation",
  "abstraction",
  "linked list",
  "stack",
  "queue",
  "tree",
  "trees",
  "graph",
  "graphs",
  "hash map",
  "hash table",
  "binary search",
  "dynamic programming",
  "memoization",
  "concurrency",
  "multithreading",
  "memory management",
  "time complexity",
  "space complexity",
  "big o",
  "authentication",
  "authorization",
  "encryption",
  "hashing",
  "http",
  "tcp",
  "udp",
  "oop",
  "object oriented",
  "compiler",
  "git",
  "github",
  "leetcode",
  "nlp",
  "computer vision",
  "embedded",
  "embedded systems",
  "iot",
  "game development",
  "ui engineering",
  "ux engineering",
  "qa",
  "testing",
  "automation",
  "blockchain",
  "web3",
  "software architecture",
  "linux",
  "bash",
  "shell scripting",
  "firebase",
  "supabase",
];

const NON_TECH_HINTS = [
  "literature",
  "poetry",
  "novel",
  "art history",
  "painting",
  "drawing",
  "music theory",
  "history",
  "philosophy",
  "sociology",
  "religion",
  "law",
  "medicine",
  "biology",
  "chemistry",
  "psychology",
  "economics",
  "marketing",
  "finance",
  "politics",
  "cooking",
  "sports",
];

function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function matchesKeyword(text, keyword) {
  if (keyword.includes(" ") || /[.#+/\\-]/.test(keyword)) {
    return text.includes(keyword);
  }

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function hasTechSignal(text) {
  return TECH_KEYWORDS.some((keyword) => matchesKeyword(text, keyword));
}

function hasNonTechSignal(text) {
  return NON_TECH_HINTS.some((keyword) => matchesKeyword(text, keyword));
}

export function isTechRelatedText(value) {
  const text = normalizeText(value);
  if (!text.trim()) return false;
  if (hasNonTechSignal(text)) return false;
  return hasTechSignal(text);
}

export function isTechCourseRequest(input = {}) {
  return isTechRelatedText(
    [
      input.title,
      input.prompt,
      input.goal,
      input.time_commitment,
      Array.isArray(input.interests) ? input.interests.join(" ") : input.interests,
      Array.isArray(input.learning_style) ? input.learning_style.join(" ") : input.learning_style,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

const TECH_FOCUS_MAP = [
  { focus: "data science", keywords: ["data", "analytics", "analysis", "statistics", "power bi", "tableau", "pandas", "numpy", "dashboard"] },
  { focus: "cybersecurity", keywords: ["security", "cyber", "threat", "risk", "defense", "privacy", "incident", "pen test", "pentest", "forensic"] },
  { focus: "artificial intelligence and machine learning", keywords: ["ai", "ml", "machine learning", "deep learning", "neural", "nlp", "computer vision", "prompt", "llm"] },
  { focus: "cloud and DevOps", keywords: ["cloud", "aws", "azure", "gcp", "devops", "docker", "kubernetes", "ci/cd", "deployment", "infra", "sre"] },
  { focus: "software engineering", keywords: ["software", "development", "programming", "coding", "app", "web", "frontend", "backend", "full stack", "api", "system design"] },
  { focus: "mobile development", keywords: ["mobile", "android", "ios", "flutter", "react native", "swift", "kotlin"] },
  { focus: "data engineering", keywords: ["etl", "pipeline", "warehouse", "lake", "spark", "airflow", "dbt", "big data"] },
  { focus: "networking", keywords: ["network", "tcp", "udp", "routing", "switching", "dns", "subnet", "protocol"] },
  { focus: "database systems", keywords: ["database", "sql", "mysql", "postgres", "mongodb", "redis", "schema", "query"] },
];

function getFirstMatchingFocus(text) {
  for (const entry of TECH_FOCUS_MAP) {
    if (entry.keywords.some((keyword) => matchesKeyword(text, keyword))) {
      return entry.focus;
    }
  }
  return null;
}

export function deriveTechnicalFocus(input = "") {
  const text = normalizeText(input);
  const matched = getFirstMatchingFocus(text);
  if (matched) return matched;

  if (text.includes("job") || text.includes("career") || text.includes("switch") || text.includes("employment")) {
    return "software engineering";
  }

  if (text.includes("build") || text.includes("project") || text.includes("portfolio")) {
    return "software engineering";
  }

  if (text.includes("learn") || text.includes("beginner") || text.includes("roadmap")) {
    return "software engineering";
  }

  return "software engineering";
}

export function isTechTutorRequest(input) {
  return isTechRelatedText(input);
}

export function techOnlyRefusalMessage() {
  return "Sorry, I can only help with technical topics like computer science, software engineering, data science, cybersecurity, AI/ML, cloud, DevOps, databases, networking, and related subjects.";
}
