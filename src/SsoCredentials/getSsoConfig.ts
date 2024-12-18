import AWSUtil from 'aws-sdk/lib/util';
import { IniFileContent } from 'aws-sdk/lib/shared-ini/ini-loader';
import { SsoIniLoader, SsoProfileConfig } from '../types';

const configOptInEnv = 'AWS_SDK_LOAD_CONFIG';
const sharedConfigFileEnv = 'AWS_CONFIG_FILE';
const sharedCredentialsFileEnv = 'AWS_SHARED_CREDENTIALS_FILE';

export function isSsoProfileConfig(c: unknown): c is SsoProfileConfig {
  if (c === undefined || c === null) return false;
  if (typeof c !== 'object') return false;
  if (
    !(
      'sso_account_id' in c
      && 'sso_region' in c
      && 'sso_role_name' in c
      && 'sso_start_url' in c
    )
  ) return false;
  if (typeof (c as SsoProfileConfig).sso_account_id !== 'string') return false;
  if (typeof (c as SsoProfileConfig).sso_region !== 'string') return false;
  if (typeof (c as SsoProfileConfig).sso_role_name !== 'string') return false;
  if (typeof (c as SsoProfileConfig).sso_start_url !== 'string') return false;
  return true;
}

const getProfilesFromCredentialsFile = (
  iniLoader: SsoIniLoader,
  filename: string | undefined,
): IniFileContent => {
  const credentialsFilename = filename
  || (process.env[configOptInEnv] && (process.env[sharedCredentialsFileEnv]
    || iniLoader.getDefaultFilePath(false)));

  try {
    const config = iniLoader.loadFrom({
      filename: credentialsFilename,
    });

    return config;
  } catch (error) {
    // if using config, assume it is fully descriptive without a credentials file:
    if (!process.env[configOptInEnv]) throw error;
  }
  return { };
};

const getProfilesFromConfigFile = (
  iniLoader: SsoIniLoader,
): IniFileContent => {
  const configFilename = process.env[sharedConfigFileEnv] || iniLoader.getDefaultFilePath(true);

  const config = iniLoader.loadFrom({
    isConfig: true,
    filename: configFilename,
  });

  return config;
};

const fillProfilesFromConfiguration = (
  configuration: IniFileContent,
  profiles: Record<string, SsoProfileConfig>,
): Record<string, SsoProfileConfig> => {
  const updatedProfiles = Object.entries(configuration).reduce(
    (acc, [profileName, profile]) => ({
      ...acc,
      [profileName]: { ...acc[profileName], ...profile },
    }),
    profiles,
  );

  return updatedProfiles;
};

const getSsoSessions = (
  iniLoader: SsoIniLoader,
  filename: string | undefined,
): IniFileContent => {
  const filenameForSessions = filename
    || process.env[sharedConfigFileEnv]
    || iniLoader.getDefaultFilePath(true);

  const config = iniLoader.loadSsoSessionsFrom ? iniLoader.loadSsoSessionsFrom({
    filename: filenameForSessions,
  }) : {};

  return config;
};

const addSsoDataToProfiles = (
  sessionConfiguration: IniFileContent,
  profiles: Record<string, SsoProfileConfig>,
) => {
  const profilesWithSessionData = profiles;

  Object.entries(profiles).forEach(([profileName, profile]) => {
    Object.entries(sessionConfiguration).forEach(([ssoSessionName, session]) => {
      if (ssoSessionName === profile.sso_session) {
        profilesWithSessionData[profileName] = {
          ...profile,
          sso_start_url: session.sso_start_url,
          sso_region: session.sso_region,
        };
      }
    });
  });

  return profilesWithSessionData;
};

/** Fork of AWSUtil.getProfilesFromSharedConfig with SSO sessions handling */
const getProfilesFromSsoConfig = (
  iniLoader: SsoIniLoader,
  filename?: string,
) => {
  const configurations: {
    profilesFromConfig: IniFileContent;
    profilesFromCredentials: IniFileContent;
    ssoSessions: IniFileContent;
  } = {
    profilesFromConfig: getProfilesFromConfigFile(iniLoader),
    profilesFromCredentials: getProfilesFromCredentialsFile(iniLoader, filename),
    ssoSessions: getSsoSessions(iniLoader, filename),
  };

  const profilesFromConfig = fillProfilesFromConfiguration(
    configurations.profilesFromConfig,
    {},
  );
  const allProfiles: Record<string, SsoProfileConfig> = fillProfilesFromConfiguration(
    configurations.profilesFromCredentials,
    profilesFromConfig,
  );

  const profilesWithSsoData = addSsoDataToProfiles(
    configurations.ssoSessions,
    allProfiles,
  );

  return profilesWithSsoData;
};

export default function getSsoConfig(options: {
  filename?: string;
  profile?: string;
}): SsoProfileConfig {
  if (!options.profile) {
    throw new Error('Cannot load SSO credentials without a profile');
  }
  const profiles = getProfilesFromSsoConfig(
    AWSUtil.iniLoader as unknown as SsoIniLoader,
    options.filename,
  );
  const config = profiles[options.profile];
  if (!isSsoProfileConfig(config)) {
    throw new Error(
      `Profile ${options.profile} does not have valid SSO credentials. Required `
        + 'parameters "sso_account_id", "sso_region", "sso_role_name", '
        + '"sso_start_url". Reference: '
        + 'https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html',
    );
  }
  return config;
}
