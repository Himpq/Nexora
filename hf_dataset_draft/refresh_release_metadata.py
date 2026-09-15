"""Refresh only metadata files for an already uploaded KwExt release."""

from __future__ import annotations

import os
from pathlib import Path

from huggingface_hub import HfApi


REPO_ID = "Himpq/kwext-bilibili-video-title-annotations"
RELEASE_DIR = Path(
    "/root/KwExt/data/releases/kwext-bilibili-video-title-annotations-v0.1"
)


def main() -> None:
    token = os.environ["HF_KEY"].strip()
    os.environ["HTTP_PROXY"] = "http://127.0.0.1:18080"
    os.environ["HTTPS_PROXY"] = "http://127.0.0.1:18080"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    api = HfApi(token=token)

    for local_path, remote_path in (
        (RELEASE_DIR / "quality_report.json", "quality_report.json"),
        (RELEASE_DIR / "manifest.json", "manifest.json"),
    ):

        info = api.upload_file(
            path_or_fileobj=str(local_path),
            path_in_repo=remote_path,
            repo_id=REPO_ID,
            repo_type="dataset",
            commit_message="Fix v0.1 release metadata paths",
        )
        print(f"uploaded {remote_path}: {info.commit_url}", flush=True)


if __name__ == "__main__":
    main()
