import { Mail } from "@/components/icons";
import { useApp } from "@/admin/app-context";
import "./impostazioni.css";

// AlphaRecall's own support address (not tenant-editable); the tenant's own
// business contacts live in the business data form.
const SUPPORT_EMAIL = "support@alpha-studio.io";

function IconLink({
  href,
  title,
  children,
  isMailto,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
  isMailto?: boolean;
}) {
  return (
    <a
      href={isMailto ? `mailto:${href}` : href}
      target={isMailto ? undefined : "_blank"}
      rel={isMailto ? undefined : "noopener noreferrer"}
      title={title}
      aria-label={title}
    >
      {children}
    </a>
  );
}

/**
 * AlphaRecall's official channels, the quiet last line of Avanzate (not a
 * settings category). The support address.
 */
export function SettingsContactFooter() {
  const { t } = useApp();
  return (
    // A div, not <footer>: inside the WordPress main landmark a footer is a misplaced contentinfo.
    <div className="ars-footer">
      <p>{t("contactSocial.footerTagline")}</p>
      <nav aria-label={t("contactSocial.title")}>
        <IconLink
          href={SUPPORT_EMAIL}
          title={`${t("contactSocial.supportLabel")} · ${SUPPORT_EMAIL}`}
          isMailto
        >
          <Mail className="size-4" />
        </IconLink>
      </nav>
    </div>
  );
}
