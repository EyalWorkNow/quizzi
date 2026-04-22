import { existsSync } from "node:fs";

const required = [
  "app/teacher/dashboard/page.tsx",
  "app/student/join/page.tsx",
  "components/teacher/assist-card.tsx",
  "components/student/join-form.tsx"
];

const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error("Missing required frontend files:\n" + missing.join("\n"));
  process.exit(1);
}

console.log("Frontend smoke check passed");
