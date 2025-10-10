// 1. Importar as bibliotecas
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');

// 2. Configurações da API
const app = express();
const PORT = process.env.PORT || 3000; // Usa a porta do Render ou 3000 como padrão
const SPREADSHEET_ID = '105-AqvOHRe-CiB4oODYL26raXLOVBfB0jI7Z3Pm_viM';
const JWT_SECRET = 'seu-segredo-super-secreto-pode-ser-qualquer-coisa';

// Configuração do CORS para aceitar qualquer origem (mais permissivo para evitar erros)
app.use(cors());
app.use(express.json());

// =================================================================
// FUNÇÕES AUXILIARES
// =================================================================

function columnIndexToLetter(index) {
  let temp, letter = '';
  while (index >= 0) {
    temp = index % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

function calculateAverage(grades) {
  const validGrades = grades
    .map(grade => parseFloat(String(grade || '0').replace(',', '.')))
    .filter(grade => grade > 0);

  if (validGrades.length === 0) return '';
  
  const sum = validGrades.reduce((acc, grade) => acc + grade, 0);
  const average = sum / validGrades.length;
  
  return average.toFixed(2).replace('.', ',');
}

async function getAuth() {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

// =================================================================
// MIDDLEWARE DE SEGURANÇA (O "PORTEIRO")
// =================================================================

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ success: false, message: "Acesso negado. Token não fornecido." });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: "Token inválido ou expirado." });
        req.user = user;
        next();
    });
};

// =================================================================
// ENDPOINTS DA API
// =================================================================

// Endpoint Raiz (Root) - para o teste de saúde do Render
app.get('/', (req, res) => {
    res.json({ message: "API do Sistema de Estágios está online!" });
});

// Endpoint de Login
app.post('/login', async (req, res) => {
    console.log('Recebida requisição de login...');
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios.' });
        }

        const googleSheets = await getAuth();
        const usersSheet = await googleSheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: '_USUARIOS!A:C',
        });
        const users = usersSheet.data.values || [];
        let userFound = null;
        for (let i = 1; i < users.length; i++) {
            const [nome, userEmail, userPassword] = users[i];
            if (userEmail && userPassword && userEmail.toLowerCase() === email.toLowerCase() && userPassword === password) {
                userFound = { nome, email: userEmail };
                break;
            }
        }

        if (userFound) {
            const accessToken = jwt.sign(userFound, JWT_SECRET, { expiresIn: '6h' });
            console.log(`Login bem-sucedido para: ${userFound.email}`);
            res.json({ success: true, message: 'Login bem-sucedido!', user: userFound, token: accessToken });
        } else {
            console.log(`Tentativa de login falhou para: ${email}`);
            res.status(401).json({ success: false, message: 'Email ou senha inválidos.' });
        }

    } catch (error) {
        console.error('ERRO NO ENDPOINT DE LOGIN:', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor.' });
    }
});

// Endpoint para carregar as opções dos filtros
app.get('/filter-options', authenticateToken, async (req, res) => {
    console.log("Buscando opções para os filtros...");
    try {
        const googleSheets = await getAuth();
        const sheetData = await googleSheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Página1',
        });

        const rows = sheetData.data.values || [];
        if (rows.length === 0) {
            return res.json({ success: true, data: {} });
        }
        const headers = rows.shift();

        const getUniqueValues = (colName) => {
            const index = headers.indexOf(colName);
            if (index === -1) return [];
            return [...new Set(rows.map(row => row[index]).filter(Boolean))].sort();
        };

        const options = {
            status: getUniqueValues('statusPreenchimento'),
            cursos: getUniqueValues('curso'),
            orientadores: getUniqueValues('nome-orientador'),
            turmas: getUniqueValues('turma-fase'),
        };

        res.json({ success: true, data: options });

    } catch (error) {
        console.error('ERRO AO BUSCAR OPÇÕES DE FILTRO:', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao buscar opções de filtro.' });
    }
});

// Endpoint para buscar os dados dos alunos
app.post('/student-data', authenticateToken, async (req, res) => {
    console.log(`Usuário '${req.user.nome}' está buscando dados de alunos...`);
    try {
        const filters = req.body;
        const googleSheets = await getAuth();
        
        const studentSheet = await googleSheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Página1',
        });

        const rows = studentSheet.data.values || [];
        if (rows.length === 0) {
            return res.json({ success: true, data: [] });
        }
        const headers = rows.shift();
        let data = rows.map(row => {
            const rowObj = {};
            headers.forEach((header, index) => {
                rowObj[header] = row[index];
            });
            return rowObj;
        });

        // Aplica os filtros
        if (filters.status) {
            data = data.filter(row => row.statusPreenchimento === filters.status);
        }
        if (filters.curso) {
            data = data.filter(row => row.curso === filters.curso);
        }
        if (filters.orientador) {
            data = data.filter(row => row['nome-orientador'] === filters.orientador);
        }
        if (filters.turma) {
            data = data.filter(row => row['turma-fase'] === filters.turma);
        }
        if (filters.nome) {
            data = data.filter(row => row['nome-completo'] && row['nome-completo'].toLowerCase().includes(filters.nome.toLowerCase()));
        }

        console.log(`Encontrados ${data.length} registros.`);
        res.json({ success: true, data: data });

    } catch (error) {
        console.error('ERRO AO BUSCAR DADOS DOS ALUNOS:', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao buscar dados.' });
    }
});

// Endpoint para atualizar as notas
app.post('/update-grades', authenticateToken, async (req, res) => {
    console.log(`Usuário '${req.user.nome}' está tentando atualizar notas...`);
    try {
        const { idRegistro, notaSupervisor, notaRelatorio, notaDefesa, observacoes } = req.body;
        const googleSheets = await getAuth();
        
        const mediaFinal = calculateAverage([notaSupervisor, notaRelatorio, notaDefesa]);

        const studentSheet = await googleSheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Página1',
        });
        
        const rows = studentSheet.data.values || [];
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Planilha vazia." });
        }
        const headers = rows[0];
        
        const columnIndexes = {
            idRegistro: headers.indexOf('idRegistro'),
            orientador: headers.indexOf('nome-orientador'),
            notaSupervisor: headers.indexOf('Nota Supervisor'),
            notaRelatorio: headers.indexOf('Nota Relatório'),
            notaDefesa: headers.indexOf('Nota da Defesa'),
            media: headers.indexOf('Média'),
            observacoes: headers.indexOf('Observações')
        };

        for (const [key, value] of Object.entries(columnIndexes)) {
            if (value === -1) {
                return res.status(500).json({ success: false, message: `Erro de configuração: A coluna "${key}" não foi encontrada na planilha.` });
            }
        }

        let targetRowIndex = -1;
        for(let i = 1; i < rows.length; i++) {
            if(rows[i][columnIndexes.idRegistro] && rows[i][columnIndexes.idRegistro].trim() === idRegistro.trim()) {
                targetRowIndex = i;
                break;
            }
        }

        if (targetRowIndex === -1) {
            return res.status(404).json({ success: false, message: "Aluno com o ID fornecido não encontrado." });
        }

        const orientadorDoAluno = rows[targetRowIndex][columnIndexes.orientador];
        if (orientadorDoAluno.trim().toUpperCase() !== req.user.nome.trim().toUpperCase()) {
            return res.status(403).json({ success: false, message: "Acesso negado: Você não é o orientador deste aluno." });
        }

        const notaSupCol = columnIndexToLetter(columnIndexes.notaSupervisor);
        const notaRelCol = columnIndexToLetter(columnIndexes.notaRelatorio);
        const notaDefCol = columnIndexToLetter(columnIndexes.notaDefesa);
        const mediaCol = columnIndexToLetter(columnIndexes.media);
        const obsCol = columnIndexToLetter(columnIndexes.observacoes);
        const rowNumber = targetRowIndex + 1;

        await googleSheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: [
                    { range: `Página1!${notaSupCol}${rowNumber}`, values: [[notaSupervisor]] },
                    { range: `Página1!${notaRelCol}${rowNumber}`, values: [[notaRelatorio]] },
                    { range: `Página1!${notaDefCol}${rowNumber}`, values: [[notaDefesa]] },
                    { range: `Página1!${mediaCol}${rowNumber}`, values: [[mediaFinal]] },
                    { range: `Página1!${obsCol}${rowNumber}`, values: [[observacoes]] },
                ]
            }
        });

        console.log(`Notas do registro ${idRegistro} atualizadas com sucesso.`);
        res.json({ success: true, message: "Notas salvas com sucesso!" });

    } catch (error) {
        console.error('ERRO AO ATUALIZAR NOTAS:', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao salvar as notas.' });
    }
});

// Inicia o servidor da API
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
