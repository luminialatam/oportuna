import { probeSmtp, sanitizedSmtpFailureCode } from './emailService.js';

type Probe = () => Promise<unknown>;
type Logger = Pick<Console, 'info' | 'error'>;

/**
 * Creates a per-process, opt-in SMTP authentication check. The probe is
 * deliberately detached from server startup: a DNS, TLS, or SMTP failure must
 * never keep the HTTP listener from serving requests.
 */
export function createSmtpStartupProbe(probe: Probe = probeSmtp, logger: Logger = console) {
  let attempted = false;

  return (env: NodeJS.ProcessEnv = process.env): void => {
    if (attempted || env.APP_ENV?.trim().toLowerCase() !== 'production'
      || env.SMTP_STARTUP_PROBE_ONCE?.trim().toLowerCase() !== 'true') return;

    attempted = true;
    void Promise.resolve()
      .then(() => probe())
      .then(() => logger.info('[email] startup_smtp_probe result=success'))
      .catch((error: unknown) => {
        logger.error(`[email] startup_smtp_probe result=failed code=${sanitizedSmtpFailureCode(error)}`);
      });
  };
}

export const runSmtpStartupProbeOnce = createSmtpStartupProbe();
