const path = require("path");
const fs = require("fs");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, ".env.local");
  if (!fs.existsSync(envPath)) return {};

  return fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .reduce((env, line) => {
      const [key, ...valueParts] = line.split("=");
      env[key.trim()] = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
      return env;
    }, {});
}

const env = loadEnvLocal();

module.exports = {
  entry: "./src/index.jsx",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.[contenthash].js",
    clean: true
  },
  resolve: {
    extensions: [".js", ".jsx"]
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [
              ["@babel/preset-env", { targets: "defaults" }],
              ["@babel/preset-react", { runtime: "automatic" }]
            ]
          }
        }
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"]
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      "process.env.REACT_APP_AZURE_OPENAI_ENDPOINT": JSON.stringify(env.REACT_APP_AZURE_OPENAI_ENDPOINT || ""),
      "process.env.REACT_APP_AZURE_OPENAI_API_KEY": JSON.stringify(env.REACT_APP_AZURE_OPENAI_API_KEY || ""),
      "process.env.REACT_APP_AZURE_OPENAI_DEPLOYMENT": JSON.stringify(env.REACT_APP_AZURE_OPENAI_DEPLOYMENT || ""),
      "process.env.REACT_APP_AZURE_OPENAI_API_VERSION": JSON.stringify(env.REACT_APP_AZURE_OPENAI_API_VERSION || "2024-10-21")
    }),
    new HtmlWebpackPlugin({
      template: "./public/index.html",
      title: "Splitwiser AI"
    })
  ],
  devServer: {
    static: "./dist",
    hot: true,
    historyApiFallback: true,
    port: 3000
  }
};
