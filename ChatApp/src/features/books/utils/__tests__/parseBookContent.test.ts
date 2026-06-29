import test from "node:test";
import assert from "node:assert/strict";

import { parseBookContent, firstChapterOf, stripTags } from "../parseBookContent";

test("stripTags removes tags but keeps inner text", () => {
  assert.equal(stripTags("<chapter_detail>真实正文</chapter_detail>"), "真实正文");
  assert.equal(stripTags("<p>a</p><p>b</p>"), "ab");
});

test("text mode splits plain text into paragraphs and strips stray tags", () => {
  const out = parseBookContent("第一段\n第二段\n<p>第三段</p>", "text");
  assert.equal(out.kind, "paragraphs");
  if (out.kind !== "paragraphs") return;
  assert.deepEqual(out.paragraphs, ["第一段", "第二段", "第三段"]);
});

test("bookdetail with body inside chapter_detail keeps the body (not empty)", () => {
  // Regression: the metadata-strip pattern used to delete chapter_detail with
  // its content, leaving an empty reading area.
  const xml =
    "<chapter><chapter_name>第一章</chapter_name><chapter_range>p1-10</chapter_range>" +
    "<chapter_summary>摘要</chapter_summary><chapter_detail>真实正文\n第二段</chapter_detail></chapter>";
  const out = parseBookContent(xml, "bookdetail");
  assert.equal(out.kind, "chapters");
  if (out.kind !== "chapters") return;
  assert.equal(out.chapters.length, 1);
  const ch = out.chapters[0];
  assert.equal(ch.name, "第一章");
  assert.equal(ch.range, "p1-10");
  assert.equal(ch.summary, "摘要");
  assert.deepEqual(ch.paragraphs, ["真实正文", "第二段"]);
  assert.equal(ch.detailXml, xml);
});

test("bookinfo with loose body text (no chapter_detail) is kept", () => {
  const xml =
    "<chapter><chapter_name>第一章</chapter_name>这里是一段正文\n另一段</chapter>";
  const out = parseBookContent(xml, "bookinfo");
  assert.equal(out.kind, "chapters");
  if (out.kind !== "chapters") return;
  assert.deepEqual(out.chapters[0].paragraphs, ["这里是一段正文", "另一段"]);
});

test("chapter metadata text does not leak into the body", () => {
  const xml =
    "<chapter><chapter_name>标题</chapter_name><chapter_range>r</chapter_range>" +
    "<chapter_detail>正文</chapter_detail></chapter>";
  const out = parseBookContent(xml, "bookdetail");
  if (out.kind !== "chapters") return;
  const body = out.chapters[0].paragraphs.join("");
  assert.equal(body, "正文");
  assert.ok(!body.includes("标题"));
  assert.ok(!body.includes("r"));
});

test("multiple chapters are parsed in order", () => {
  const xml =
    "<chapter><chapter_name>一</chapter_name><chapter_range>r1</chapter_range><chapter_detail>A</chapter_detail></chapter>" +
    "<chapter><chapter_name>二</chapter_name><chapter_range>r2</chapter_range><chapter_detail>B</chapter_detail></chapter>";
  const out = parseBookContent(xml, "bookdetail");
  if (out.kind !== "chapters") return;
  assert.deepEqual(
    out.chapters.map((c) => c.name),
    ["一", "二"],
  );
});

test("no chapter blocks in bookinfo mode falls back to flat paragraphs", () => {
  const out = parseBookContent("<chapter_detail>裸文本</chapter_detail>", "bookinfo");
  assert.equal(out.kind, "paragraphs");
  if (out.kind !== "paragraphs") return;
  assert.deepEqual(out.paragraphs, ["裸文本"]);
});

test("empty content returns no paragraphs", () => {
  const out = parseBookContent("", "bookinfo");
  assert.equal(out.kind, "paragraphs");
  if (out.kind !== "paragraphs") return;
  assert.equal(out.paragraphs.length, 0);
});

test("firstChapterOf returns the first chapter or null", () => {
  assert.equal(firstChapterOf({ kind: "paragraphs", paragraphs: ["a"] }), null);
  const xml =
    "<chapter><chapter_name>首章</chapter_name><chapter_range>r</chapter_range><chapter_detail>x</chapter_detail></chapter>";
  const parsed = parseBookContent(xml, "bookdetail");
  const first = firstChapterOf(parsed);
  assert.equal(first?.name, "首章");
});

test("nested tags inside chapter_detail are unwrapped, text preserved", () => {
  const xml =
    "<chapter><chapter_name>c</chapter_name><chapter_detail><p>段落A</p><p>段落B</p></chapter_detail></chapter>";
  const out = parseBookContent(xml, "bookdetail");
  if (out.kind !== "chapters") return;
  assert.deepEqual(out.chapters[0].paragraphs, ["段落A段落B"]);
});
