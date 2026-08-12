import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Preloaded before every test file.
 *
 * cocopit's own state lives in ~/.cocopit, and tests that build a server read
 * it — so whether the suite passed depended on the developer's machine. Setting
 * an access token there was enough to make a dozen route tests fail with 401.
 * Point every run at a throwaway directory instead; a test that wants its own
 * still overrides this in beforeEach.
 */
process.env.COCOPIT_HOME = mkdtempSync(join(tmpdir(), "cocopit-test-home-"));
