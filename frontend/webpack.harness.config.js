// BRW-4 GATE-ONLY webpack config -- bundles browserCanvasCdpHarness.tsx (real
// BrowserCanvasCdp.tsx, no stand-in) for the manual real-integration gate driven by
// scripts/browserCanvasCdp.integration-check.mjs. NOT part of the shipped app: the real build
// (`npm run build`, frontend/webpack.config.js) has its own entry (src/index.tsx) and never loads
// this file or the harness module it bundles. Invoke by hand:
//   cd frontend && npx webpack --config webpack.harness.config.js
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: path.resolve(__dirname, 'src/app/pages/Dashboard/cards/browser/browserCanvasCdpHarness.tsx'),
  output: {
    path: path.resolve(__dirname, '.gate-harness-dist'),
    filename: 'harness.bundle.js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx|ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: 'defaults' }],
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-typescript',
            ],
          },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  plugins: [
    // Same DefinePlugin entry as the real webpack.config.js -- BrowserCanvasCdp.tsx doesn't
    // itself read MAESTRO_BROWSER_ENGINE (BrowserCard.tsx's useCdpEngine branch decides whether
    // to render it at all), but browserScreencastClient.ts is bundled through the same pipeline
    // and this keeps the two configs from silently diverging on how process.env is handled.
    new webpack.DefinePlugin({
      'process.env.MAESTRO_BROWSER_ENGINE': JSON.stringify('cdp'),
    }),
    new HtmlWebpackPlugin({
      templateContent: '<!doctype html><html><body style="margin:0"><div id="root"></div></body></html>',
      filename: 'index.html',
    }),
  ],
  devtool: false,
};
