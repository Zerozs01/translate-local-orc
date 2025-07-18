const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    content: './src/content.ts',
    popup: './src/popup.ts',
    background: './src/background.ts',
    offscreen: './src/offscreen.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { 
          from: "src/manifest.json",
          to: "manifest.json"
        },
        {
          from: "src/traineddata",
          to: "traineddata"       
        },
        {
          from: "node_modules/tesseract.js-core/",
          to: "tesseract.js-core"
        },
        {
          from: "src/offscreen.html", 
          to: "offscreen.html"
        },
        {
          from: "src/popup.html",
          to: "popup.html"
        },
        { from: "src/assets/pendrive1.png", to: "pendrive1.png" }

      ],
    }),
  ]
}; 