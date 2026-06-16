import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  'export-import-kkm': {
    enabled: true,
  },
  documentation: {
    enabled: true,
  },
});

export default config;
