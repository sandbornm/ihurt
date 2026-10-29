import { Languages } from "lucide-react";
import { setLanguagePreference, type LanguagePreference } from "./index";
import { useI18n } from "./react";

export default function LanguageSetting() {
  const { t, preference } = useI18n();
  return (
    <label className="language-setting">
      <Languages size={17} aria-hidden="true" />
      <span className="sr-only">{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        value={preference}
        onChange={(event) =>
          setLanguagePreference(event.target.value as LanguagePreference)
        }
      >
        <option value="auto">{t("language.auto")}</option>
        <option value="en" lang="en">
          English
        </option>
        <option value="es" lang="es">
          Español
        </option>
      </select>
    </label>
  );
}
