const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
   mode: "development",
  devtool: "eval-source-map",
  entry: "./src/index.jsx",

  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.[contenthash].js",
    clean: true,
    publicPath: "/",
  },

  resolve: {
    extensions: [".js", ".jsx"],
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
              ["@babel/preset-react", { runtime: "automatic" }],
            ],
          },
        },
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: "./public/index.html",
      title: "Splitwiser AI",
    }),
  ],

  devServer: {
    static: "./dist",
    hot: true,
    historyApiFallback: true,
    port: 3000,
  },
};