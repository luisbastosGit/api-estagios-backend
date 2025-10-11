// 1. Importar as bibliotecas
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');

// 2. Configurações da API
const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '105-AqvOHRe-CiB4oODYL26raXLOVBfB0jI7Z3Pm_viM';
const JWT_SECRET = 'seu-segredo-super-secreto-pode-ser-qualquer-coisa';

// Lista de sites (origens) que podem aceder a esta API
const allowedOrigins = [
  'https://luisbastosgit.github.io', // A URL base dos seus sites
];

// Configuração final do CORS
app.use(cors({
  origin: function (origin, callback) {
    // Permite pedidos sem origem (como apps mobile ou Postman/Thunder Client)
    if (!origin) return callback(null, true);
    
    // Verifica se a origem do pedido está na nossa lista de permissões
    // Usamos startsWith para permitir '.../consulta_TceIFC' e '.../termos-estagio-ifc'
    if (allowedOrigins.some(allowedOrigin => origin.startsWith(allowedOrigin))) {
      callback(null, true);
    } else {
      callback(new Error('A política de CORS para este site não permite o acesso.'));
    }
  }
}));

app.use(express.json());

// =================================================================
// FUNÇÕES AUXILIARES E DE AUTENTICAÇÃO...
// (O resto do código permanece o mesmo)
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
  const googleSheets = google.sheets({ version: 'v4', auth: client });
  return { googleSheets };
}

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

app.get('/', (req, res) => {
  res.json({ message: "API do Sistema de Estágios está online!" });
});

app.post('/login', async (req, res) => {
  console.log('Recebida requisição de login...');
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios.' });
    }

    const { googleSheets } = await getAuth();
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
      res.json({ success: true, user: userFound, token: accessToken });
    } else {
      res.status(401).json({ success: false, message: 'Email ou senha inválidos.' });
    }

  } catch (error) {
    console.error('ERRO NO ENDPOINT DE LOGIN:', error);
    res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor.' });
  }
});

app.get('/filter-options', async (req, res) => {
    console.log('Buscando opções de filtro...');
    try {
        const { googleSheets } = await getAuth();
        const sheet = await googleSheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Página1!A:AZ',
        });

        const rows = sheet.data.values || [];
        const headers = rows.shift();
        const statusIndex = headers.indexOf('statusPreenchimento');
        const cursoIndex = headers.indexOf('curso');
        const orientadorIndex = headers.indexOf('nome-orientador');
        const turmaIndex = headers.indexOf('turma-fase');
        const matriculaIndex = headers.indexOf('matricula');

        const uniqueValues = (index) => {
            if (index === -1) return [];
            return [...new Set(rows.map(row => row[index]).filter(Boolean))];
        };
        
        const years = [...new Set(rows.map(row => row[matriculaIndex] ? row[matriculaIndex].substring(0, 4) : null).filter(Boolean))];

        res.json({
            success: true,
            data: {
                status: uniqueValues(statusIndex).sort(),
                cursos: uniqueValues(cursoIndex).sort(),
                orientadores: uniqueValues(orientadorIndex).sort(),
                turmas: uniqueValues(turmaIndex).sort(),
                anos: years.sort((a, b) => b - a),
            }
        });
    } catch (error) {
        console.error('ERRO AO BUSCAR OPÇÕES DE FILTRO:', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor.' });
    }
});

app.post('/student-data', authenticateToken, async (req, res) => {
  console.log(`Usuário '${req.user.nome}' está buscando dados de alunos...`);
  try {
    const filters = req.body;
    const { googleSheets } = await getAuth();
    
    const studentSheet = await googleSheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Página1',
    });

    const rows = studentSheet.data.values || [];
    const headers = rows.shift();
    
    let data = rows.map(row => {
        const rowObj = {};
        headers.forEach((header, index) => {
            rowObj[header] = row[index];
        });
        return rowObj;
    });

    if (filters.status) data = data.filter(row => row.statusPreenchimento === filters.status);
    if (filters.curso) data = data.filter(row => row.curso === filters.curso);
    if (filters.orientador) data = data.filter(row => row['nome-orientador'] === filters.orientador);
    if (filters.turma) data = data.filter(row => row['turma-fase'] === filters.turma);
    if (filters.nome) data = data.filter(row => row['nome-completo'] && row['nome-completo'].toLowerCase().includes(filters.nome.toLowerCase()));
    if (filters.ano) data = data.filter(row => row.matricula && row.matricula.startsWith(filters.ano));
    if (filters.cpf) data = data.filter(row => row.cpf && row.cpf.replace(/\D/g, '').includes(filters.cpf.replace(/\D/g, '')));
    
    res.json({ success: true, data: data });

  } catch (error) {
      console.error('ERRO AO BUSCAR DADOS DOS ALUNOS:', error);
      res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao buscar dados.' });
  }
});

app.post('/update-grades', authenticateToken, async (req, res) => {
  console.log(`Usuário '${req.user.nome}' está tentando atualizar notas...`);
  try {
    const { idRegistro, notaSupervisor, notaRelatorio, notaDefesa, observacoes } = req.body;
    const { googleSheets } = await getAuth();
    
    const mediaFinal = calculateAverage([notaSupervisor, notaRelatorio, notaDefesa]);

    const studentSheet = await googleSheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Página1',
    });
    
    const rows = studentSheet.data.values || [];
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
    
    res.json({ success: true, message: "Notas salvas com sucesso!" });

  } catch (error) {
    console.error('ERRO AO ATUALIZAR NOTAS:', error);
    res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao salvar as notas.' });
  }
});

app.post('/complete-registration', async (req, res) => {
    console.log('Recebida requisição para completar cadastro...');
    try {
        const formData = req.body;
        const { idRegistro } = formData;
        
        if (!idRegistro) {
            return res.status(400).json({ success: false, message: 'ID de registro não fornecido.' });
        }

        const { googleSheets } = await getAuth();
        const sheet = await googleSheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Página1',
        });

        const rows = sheet.data.values || [];
        const headers = rows[0];
        const idRegistroColIndex = headers.indexOf('idRegistro');

        let targetRowIndex = -1;
        for(let i = 1; i < rows.length; i++) {
            if(rows[i][idRegistroColIndex] && rows[i][idRegistroColIndex].trim() === idRegistro.trim()) {
                targetRowIndex = i;
                break;
            }
        }

        if (targetRowIndex === -1) {
            return res.status(404).json({ success: false, message: "Registro de estágio não encontrado." });
        }

        const rowNumber = targetRowIndex + 1;
        const updateData = [];
        
        for (const key in formData) {
            if (key === 'idRegistro') continue;
            
            const colIndex = headers.indexOf(key);
            if (colIndex !== -1) {
                const colLetter = columnIndexToLetter(colIndex);
                updateData.push({
                    range: `Página1!${colLetter}${rowNumber}`,
                    values: [[formData[key]]]
                });
            }
        }

        const statusColIndex = headers.indexOf('statusPreenchimento');
        if (statusColIndex !== -1) {
            const statusColLetter = columnIndexToLetter(statusColIndex);
            updateData.push({
                range: `Página1!${statusColLetter}${rowNumber}`,
                values: [['Concluído']]
            });
        }
        
        if (updateData.length > 0) {
            await googleSheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: updateData
                }
            });
        }

        res.json({ success: true, message: 'Cadastro completado com sucesso! Obrigado.' });

    } catch (error) {
        console.error('ERRO AO COMPLETAR CADASTRO:', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor.' });
    }
});

// Inicia o servidor da API
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

