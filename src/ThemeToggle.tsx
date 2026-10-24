import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "./i18n/react";

type Theme = "light" | "dark";
const key = "ihurt-theme";
function preferred(): Theme {
  try {
    const saved = localStorage.getItem(key);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
document.documentElement.dataset.theme = preferred();

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(preferred);
  const { t } = useI18n();
  useEffect(() => {
    const sync = () => {
      const next = preferred();
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    const media = matchMedia("(prefers-color-scheme: light)");
    window.addEventListener("storage", sync);
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      media.removeEventListener("change", sync);
    };
  }, []);
  return (
    <button
      className="theme-toggle"
      aria-label={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        setTheme(next);
        try {
          localStorage.setItem(key, next);
        } catch {}
      }}
    >
      {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
      <span>{theme === "dark" ? t("theme.light") : t("theme.dark")}</span>
    </button>
  );
}
