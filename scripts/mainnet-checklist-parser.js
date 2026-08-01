export function updateChecklistContent({ content, repoUrl, closedIssues }) {
  const escapedRepoUrl = repoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const issueRegex = new RegExp(`${escapedRepoUrl}(\\d+)`);

  return content
    .split('\n')
    .map((line) => {
      if (!line.startsWith('|') || !line.includes(repoUrl)) {
        return line;
      }

      const issueMatch = line.match(issueRegex);
      if (!issueMatch || !closedIssues.has(Number(issueMatch[1]))) {
        return line;
      }

      const cells = line.split('|');
      if (cells.length < 6) {
        return line;
      }

      cells[4] = ' Done ';
      return cells.join('|');
    })
    .join('\n');
}

export function extractLinkedIssueNumbers(content, repoUrl) {
  const escapedRepoUrl = repoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const issueRegex = new RegExp(`${escapedRepoUrl}(\\d+)`, 'g');
  const issueNumbers = [...content.matchAll(issueRegex)].map((match) => Number(match[1]));
  return [...new Set(issueNumbers)];
}
