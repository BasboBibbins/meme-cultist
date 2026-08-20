// Pure formatting for /lyrics, extracted so the truncation rule has a test.
//
// Discord rejects a description over 4096, and most songs clear that. The old command
// let setDescription throw into the same catch that reported "could not find lyrics",
// so a song that was found and fetched successfully was reported as missing.

const DESCRIPTION_LIMIT = 4096;

function formatLyrics(lyrics) {
  return String(lyrics ?? "").split("\n")
    .map((line, index) => {
      if (index === 0 && line.trim() !== "") return "";
      if (line.startsWith("[") && line.endsWith("]")) return `**${line}**`;
      return line;
    })
    .join("\n");
}

// Cut on a line break so a verse does not end mid-word, and leave room for the notice.
function truncate(text, url, limit = DESCRIPTION_LIMIT) {
  const body = String(text ?? "");
  if (body.length <= limit) return { text: body, truncated: false };

  const notice = `\n\n-# Too long for one message. [Read the rest on Genius](${url})`;
  const budget = Math.max(0, limit - notice.length);
  const cut = body.slice(0, budget);
  const lastBreak = cut.lastIndexOf("\n");
  const kept = lastBreak > budget / 2 ? cut.slice(0, lastBreak) : cut;
  return { text: `${kept}${notice}`, truncated: true };
}

// A title like "Artist - Song" is the bridged form, where the halves are the wrong way round for a lyrics search.
function queryFor(track) {
  const title = String(track?.title ?? "").trim();
  if (!title) return "";
  if (!title.includes(" - ")) return `${title} ${track?.author ?? ""}`.trim();
  const [left, right] = title.split(" - ");
  return `${right} ${left}`.trim();
}

module.exports = { formatLyrics, truncate, queryFor, DESCRIPTION_LIMIT };
