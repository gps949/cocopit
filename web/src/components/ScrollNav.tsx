import { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "./icons";

/**
 * Floating jump-to-top / jump-to-bottom buttons for long pages (session
 * transcripts especially). They only exist when the page is at least two
 * screens tall and the respective edge is far away, so short pages and
 * near-edge positions stay uncluttered. The app scrolls on window — session
 * detail's upward-loading anchor depends on that — so this reads window
 * scroll too.
 */
export function ScrollNav() {
  const [show, setShow] = useState({ up: false, down: false });

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const long = doc.scrollHeight > window.innerHeight * 2;
      const fromTop = window.scrollY;
      const fromBottom = doc.scrollHeight - fromTop - window.innerHeight;
      setShow({ up: long && fromTop > 600, down: long && fromBottom > 600 });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // content arrives asynchronously (messages, charts) and grows the page
    // without any scroll event, so watch the body's size too
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (!show.up && !show.down) return null;

  const btn =
    "flex size-9 items-center justify-center rounded-full border border-line bg-panel/95 text-muted shadow-md backdrop-blur transition-colors hover:text-ink hover:border-accent";

  return (
    <div className="fixed bottom-4 right-4 z-20 flex flex-col gap-1.5 sm:bottom-6 sm:right-6">
      {show.up && (
        <button
          type="button"
          aria-label="back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className={btn}
        >
          <ChevronUpIcon className="size-[18px]" />
        </button>
      )}
      {show.down && (
        <button
          type="button"
          aria-label="jump to bottom"
          onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}
          className={btn}
        >
          <ChevronDownIcon className="size-[18px]" />
        </button>
      )}
    </div>
  );
}
