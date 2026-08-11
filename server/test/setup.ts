import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Preloaded before every test file.
 *
 * ccockpit's own state lives in ~/.ccockpit, and tests that build a server read
 * it — so whether the suite passed depended on the developer's machine. Setting
 * an access token there was enough to make a dozen route tests fail with 401.
 * Point every run at a throwaway directory instead; a test that wants its own
 * still overrides this in beforeEach.
 */
process.env.CCOCKPIT_HOME = mkdtempSync(join(tmpdir(), "ccockpit-test-home-"));
