import json
import unittest

from basis.Tool.Presenter import ToolResultPresenter


class ExaMediaPresentationTest(unittest.TestCase):

    def setUp(self):
        self.presenter = ToolResultPresenter()
        self.payload = {
            "success": True,
            "query": "Nexora",
            "results": [
                {
                    "title": "第一张",
                    "url": "https://example.com/one",
                    "image": "https://cdn.example.com/one.jpg",
                    "snippet": "第一条摘要",
                },
                {
                    "title": "站点图标",
                    "url": "https://example.com/two",
                    "image": "https://cdn.example.com/favicon.png",
                    "snippet": "不应进入画廊",
                },
                {
                    "title": "重复图片",
                    "url": "https://example.com/three",
                    "image": "https://cdn.example.com/one.jpg",
                    "snippet": "不应重复",
                },
            ],
        }

    def test_exa_text_renderer_does_not_emit_markdown_images(self):
        rendered = self.presenter.render(
            "exa_web_search",
            {"query": "Nexora"},
            json.dumps(self.payload, ensure_ascii=False),
        )

        self.assertIsInstance(rendered, str)
        self.assertNotIn("![", rendered)
        self.assertIn("第一条摘要", rendered)

    def test_exa_media_extractor_returns_filtered_gallery_items(self):
        media = self.presenter.extract_display_media(
            "exa_web_search",
            {"query": "Nexora"},
            json.dumps(self.payload, ensure_ascii=False),
        )

        self.assertEqual(media["type"], "exa_image_gallery")
        self.assertEqual(media["query"], "Nexora")
        self.assertEqual(len(media["items"]), 1)
        self.assertEqual(media["items"][0]["image_url"], "https://cdn.example.com/one.jpg")
        self.assertEqual(media["items"][0]["source_url"], "https://example.com/one")


if __name__ == "__main__":
    unittest.main()
