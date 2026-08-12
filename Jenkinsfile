// Jenkinsfile — Kryptos
// -------------------------------------------------------------------
// Réplica del pipeline para Jenkins. Cubre las métricas de la fila
// "Jenkins / CircleCI" de la tabla de métricas DevOps:
//   - Build Success Rate
//   - Duración de pipelines
//   - Análisis de fallos en integración continua
//
// NOTA: requiere un controlador Jenkins con el plugin NodeJS
// configurado (herramienta "Node20") y acceso a este repo. Jenkins ya
// trae de forma nativa gráficos de duración y de éxito/fallo por build
// en el historial del job; además dejamos el registro en
// metrics/*.jsonl para que sea comparable con las demás plataformas.
// -------------------------------------------------------------------

pipeline {
    agent any

    tools {
        nodejs 'Node20'
    }

    options {
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '50'))
    }

    triggers {
        githubPush()
    }

    stages {
        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Build & Typecheck') {
            steps {
                sh 'npm run build'
            }
        }
    }

    post {
        always {
            script {
                def resultado = currentBuild.currentResult == 'SUCCESS' ? 'success' : 'failure'
                def commit = env.GIT_COMMIT ?: 'unknown'
                def url = env.BUILD_URL ?: ''
                sh "node scripts/dora-metrics.mjs record-build ${resultado} ${commit} ${url}"

                echo "== Análisis de fallos en integración continua =="
                echo "Resultado: ${currentBuild.currentResult}"
                echo "Duración del pipeline: ${currentBuild.durationString}"
            }
        }
    }
}
