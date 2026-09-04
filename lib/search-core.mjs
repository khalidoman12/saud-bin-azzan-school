const ARABIC_MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const WHITESPACE = /\s+/g;

/**
 * Search-only Arabic normalization. The stored display name is never changed.
 * @param {string} value
 * @param {{soft?: boolean, compact?: boolean}} options
 */
export function normalizeArabic(value, options = {}) {
  const { soft = false, compact = false } = options;
  let normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(ARABIC_MARKS, "")
    .replaceAll("ـ", "")
    .replace(/[أإآٱ]/g, "ا")
    .replaceAll("ى", "ي");

  if (soft) {
    normalized = normalized
      .replaceAll("ة", "ه")
      .replaceAll("ؤ", "و")
      .replaceAll("ئ", "ي");
  }

  normalized = normalized.replace(WHITESPACE, " ").trim();
  return compact ? normalized.replaceAll(" ", "") : normalized;
}

function editDistance(a, b) {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(columns).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      );

      if (
        row > 1 &&
        column > 1 &&
        a[row - 1] === b[column - 2] &&
        a[row - 2] === b[column - 1]
      ) {
        matrix[row][column] = Math.min(
          matrix[row][column],
          matrix[row - 2][column - 2] + 1,
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

function tokenMatchScore(queryToken, nameToken) {
  if (queryToken === nameToken) return 100;
  if (nameToken.startsWith(queryToken)) return 92;
  if (nameToken.includes(queryToken)) return 82;
  if (queryToken.length < 3) return 0;
  if (queryToken[0] !== nameToken[0]) return 0;

  const distance = editDistance(queryToken, nameToken);
  const allowedDistance = queryToken.length >= 7 ? 2 : 1;
  if (distance <= allowedDistance) return 62 - distance * 8;
  return 0;
}

/**
 * @param {Record<string, any>} student
 * @param {string} query
 */
export function scoreStudent(student, query) {
  const queryPrimary = normalizeArabic(query);
  if (!queryPrimary) return 1;

  const querySoft = normalizeArabic(query, { soft: true });
  const queryCompact = normalizeArabic(query, { soft: true, compact: true });
  const namePrimary = student.searchName;
  const nameSoft = student.softSearchName;
  const nameCompact = student.compactSearchName;
  const enrollmentNumber = student.enrollmentNumber ?? "";

  if (enrollmentNumber && enrollmentNumber === query.trim()) return 1100;
  if (namePrimary === queryPrimary) return 1000;
  if (namePrimary.startsWith(queryPrimary)) return 940;
  if (namePrimary.includes(queryPrimary)) return 860;
  if (nameSoft.includes(querySoft)) return 780;
  if (nameCompact.includes(queryCompact)) return 740;

  const queryTokens = querySoft.split(" ").filter(Boolean);
  const nameTokens = nameSoft.split(" ").filter(Boolean);
  const tokenScores = queryTokens.map((queryToken) =>
    Math.max(0, ...nameTokens.map((nameToken) => tokenMatchScore(queryToken, nameToken))),
  );

  if (tokenScores.some((score) => score === 0)) return 0;
  const average = tokenScores.reduce((sum, value) => sum + value, 0) / tokenScores.length;
  const firstNameBonus = tokenMatchScore(queryTokens[0], nameTokens[0]) >= 90 ? 25 : 0;
  const allTokensAreDirect = tokenScores.every((score) => score >= 82);
  return Math.round((allTokensAreDirect ? 700 : 540) + average + firstNameBonus);
}

/**
 * @param {Array<Record<string, any>>} students
 * @param {{query?: string, grade?: number|null, section?: number|null}} filters
 */
export function filterAndRankStudents(students, filters = {}) {
  const query = String(filters.query ?? "").trim();
  const grade = filters.grade ?? null;
  const section = filters.section ?? null;

  const matches = students
    .filter((student) => grade === null || student.grade === grade)
    .filter((student) => section === null || student.section === section)
    .map((student) => ({ student, score: scoreStudent(student, query) }))
    .filter(({ score }) => score > 0);

  const hasDirectMatches = Boolean(query) && matches.some(({ score }) => score >= 700);

  return matches
    .filter(({ score }) => !hasDirectMatches || score >= 700)
    .sort((a, b) => {
      if (query && b.score !== a.score) return b.score - a.score;
      return (
        a.student.grade - b.student.grade ||
        a.student.section - b.student.section ||
        a.student.rosterOrder - b.student.rosterOrder
      );
    });
}
