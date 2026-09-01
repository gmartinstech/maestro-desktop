const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isDevelopment = argv.mode === 'development';

  return {
    entry: './src/index.tsx',

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
      publicPath: isDevelopment ? '/' : './',
      clean: true
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
                '@babel/preset-typescript'
              ]
            }
          }
        },
        {
          // Plain CSS had no loader until xterm.js arrived with a stylesheet the terminal cannot render correctly without.
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        },
        {
          test: /\.module\.(scss|sass)$/,
          use: [
            'style-loader',
            'css-modules-types-loader',
            {
              loader: 'css-loader',
              options: {
                modules: {
                  localIdentName: '[name]__[local]___[hash:base64:5]'
                }
              }
            },
            'sass-loader'
          ]
        }
      ]
    },

    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },

    plugins: [
      // BRW-4 safety switch (see frontend/src/shared/browserEngineMode.ts): baked in at build
      // time from the host env, same posture as MAESTRO_MOCK_AGENT (CLAUDE.md) -- there is no
      // live `process` global in the packaged renderer to read this from at runtime. Unset
      // defaults to 'electron', today's unmodified webview path.
      new webpack.DefinePlugin({
        'process.env.MAESTRO_BROWSER_ENGINE': JSON.stringify(process.env.MAESTRO_BROWSER_ENGINE || 'electron'),
      }),
      new HtmlWebpackPlugin({
        template: './public/index.html',
        filename: 'index.html',
        favicon: './public/favicon.ico'
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'public',
            to: '.',
            globOptions: { ignore: ['**/index.html', '**/favicon.ico'] },
          },
        ],
      }),
    ],

    devtool: isDevelopment ? 'source-map' : false,

    devServer: {
      static: { directory: path.join(__dirname, 'public') },
      compress: true,
      port: 3000,
      hot: true,
      open: false,
      historyApiFallback: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8324',
          changeOrigin: true,
        },
      },
    }
  };
};
