import { resolve } from "node:path"
import { defineConfig, loadEnv } from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy"
import livereload from "rollup-plugin-livereload"
import zipPack from "vite-plugin-zip-pack"
import fg from 'fast-glob'

import vitePluginYamlI18n from './yaml-plugin'
import { readFileSync } from "node:fs"

const pluginInfo = JSON.parse(readFileSync("./plugin.json", "utf8"))

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd())
    const {
        VITE_SIYUAN_WORKSPACE_PATH,
    } = env

    const siyuanWorkspacePath = VITE_SIYUAN_WORKSPACE_PATH
    const isWatch = mode === 'development'

    let devDistDir = './dev'
    if (siyuanWorkspacePath) {
        devDistDir = `${siyuanWorkspacePath}/data/plugins/${pluginInfo.name}`
    }
    const distDir = isWatch ? devDistDir : "./dist"

    console.log("mode=>", mode)
    console.log("isWatch=>", isWatch)
    console.log("distDir=>", distDir)

    return {
        resolve: {
            alias: {
                "@": resolve(__dirname, "src"),
            }
        },

        plugins: [
            vitePluginYamlI18n({
                inDir: 'public/i18n',
                outDir: `${distDir}/i18n`
            }),

            viteStaticCopy({
                targets: [
                    { src: "./README*.md", dest: "./" },
                    { src: "./plugin.json", dest: "./" },
                    { src: "./preview.png", dest: "./" },
                    { src: "./icon.png", dest: "./" }
                ],
            }),
        ],

        define: {
            "process.env.DEV_MODE": JSON.stringify(isWatch),
            "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV)
        },

        build: {
            outDir: distDir,
            emptyOutDir: !isWatch,
            minify: !isWatch,
            sourcemap: isWatch ? 'inline' : false,

            lib: {
                entry: resolve(__dirname, "src/index.ts"),
                fileName: "index",
                formats: ["cjs"],
            },
            rollupOptions: {
                plugins: [
                    ...(isWatch ? [
                        livereload(distDir),
                        {
                            name: 'watch-external',
                            async buildStart() {
                                const files = await fg([
                                    'public/i18n/**',
                                    './README*.md',
                                    './plugin.json'
                                ])
                                for (const file of files) {
                                    this.addWatchFile(file)
                                }
                            }
                        }
                    ] : [
                        // Clean up unnecessary files under dist dir
                        cleanupDistFiles({
                            patterns: ['i18n/*.yaml', 'i18n/*.md'],
                            distDir: distDir
                        }),
                        zipPack({
                            inDir: './dist',
                            outDir: './',
                            outFileName: 'package.zip'
                        })
                    ])
                ],

                external: ["siyuan", "process"],

                output: {
                    entryFileNames: "[name].js",
                    assetFileNames: (assetInfo) => {
                        if (assetInfo.name === "style.css") {
                            return "index.css"
                        }
                        return assetInfo.name
                    },
                },
            },
        }
    }
})


/**
 * Clean up some dist files after compiled
 * @param options:
 * @returns
 */
function cleanupDistFiles(options: { patterns: string[], distDir: string }) {
    const {
        patterns,
        distDir
    } = options

    return {
        name: 'rollup-plugin-cleanup',
        enforce: 'post' as const,
        writeBundle: {
            sequential: true,
            order: 'post' as const,
            async handler() {
                const fg = await import('fast-glob')
                const fs = await import('node:fs')

                const distPatterns = patterns.map(pat => `${distDir}/${pat}`)
                console.debug('Cleanup searching patterns:', distPatterns)

                const files = await fg.default(distPatterns, {
                    dot: true,
                    absolute: true,
                    onlyFiles: false
                })

                for (const file of files) {
                    try {
                        if (fs.default.existsSync(file)) {
                            const stat = fs.default.statSync(file)
                            if (stat.isDirectory()) {
                                fs.default.rmSync(file, { recursive: true })
                            } else {
                                fs.default.unlinkSync(file)
                            }
                            console.log(`Cleaned up: ${file}`)
                        }
                    } catch (error) {
                        console.error(`Failed to clean up ${file}:`, error)
                    }
                }
            }
        }
    }
}
