import nextConfig from 'eslint-config-next';

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      'no-console': 'off',
    },
  },
];

export default eslintConfig;
