import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from validateSharkaspWebConfig import validate  # noqa: E402


class SharkaspWebConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.site = Path(self.temp.name)
        self.config = self.site / "web.config"
        self.bootstrap = self.site / "sharkasp-bootstrap.mjs"
        self.bootstrap.write_text("// isolated test bootstrap", encoding="utf-8")
        self.valid = (Path(__file__).resolve().parents[2] / "web.config").read_text(encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def write(self, content):
        self.config.write_text(content, encoding="utf-8")

    def test_accepts_production_config(self):
        self.write(self.valid)
        validate(self.config)

    def test_rejects_missing_http_platform_handler(self):
        self.write(self.valid.replace('<add name="httpPlatformHandler" path="*" verb="*" modules="httpPlatformHandler" />', "", 1))
        with self.assertRaisesRegex(ValueError, "httpPlatformHandler"):
            validate(self.config)

    def test_rejects_missing_http_platform_or_bootstrap(self):
        root = ET.fromstring(self.valid)
        server = root.find("system.webServer")
        server.remove(server.find("httpPlatform"))
        self.write(ET.tostring(root, encoding="unicode"))
        with self.assertRaisesRegex(ValueError, "httpPlatform"):
            validate(self.config)
        self.write(self.valid)
        self.bootstrap.unlink()
        with self.assertRaisesRegex(ValueError, "startup file"):
            validate(self.config)

    def test_rejects_spa_rewrite_rules(self):
        self.write(self.valid.replace("</system.webServer>", "<rewrite><rules /></rewrite></system.webServer>"))
        with self.assertRaisesRegex(ValueError, "rewrite"):
            validate(self.config)


if __name__ == "__main__":
    unittest.main(verbosity=2)
