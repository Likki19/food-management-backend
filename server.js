const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { sendEmail, sendSMS } = require('./notificationService'); // Keep only one import
const { testEmail } = require('./notificationService');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'your-secret-key'; // In production, use environment variable

app.use(cors());
app.use(bodyParser.json());

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const DONATIONS_FILE = path.join(__dirname, 'data', 'donations.json');
const CONTACTS_FILE = path.join(__dirname, 'data', 'contacts.json');

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Authorization required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};
// Login endpoint
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const usersData = await readJsonFile(USERS_FILE);
        const user = usersData.users.find(u => 
            u.username === username && u.password === password
        );

        if (user) {
            const token = jwt.sign(
                { id: user.id, username: user.username, type: user.type },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token,
                userType: user.type,
                message: 'Login successful'
            });
        } else {
            res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Register endpoint
app.post('/register', async (req, res) => {
    const { username, password, email, phone, userType, organization, area } = req.body;

    try {
        const usersData = await readJsonFile(USERS_FILE);
        
        if (usersData.users.some(u => u.username === username)) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists'
            });
        }

        const newUser = {
            id: (usersData.users.length + 1).toString(),
            username,
            password,
            email,
            type: userType,
            phone,
            createdAt: new Date().toISOString()
        };

        if (userType === 'ngo') {
            newUser.organization = organization;
            newUser.area = area;
        }

        usersData.users.push(newUser);
        await writeJsonFile(USERS_FILE, usersData);

        res.json({
            success: true,
            message: 'Registration successful! Please login.'
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});
// Create donation endpoint - Modified to allow both donors and NGOs
// Create donation endpoint
    
    
// Updated donation creation endpoint
app.post('/api/donations', authenticateToken, async (req, res) => {
    if (!['donor', 'ngo'].includes(req.user.type)) {
        return res.status(403).json({
            success: false,
            message: 'Only donors and NGOs can create donations'
        });
    }

    try {
        const donationsData = await readJsonFile(DONATIONS_FILE);
        const usersData = await readJsonFile(USERS_FILE);

        const newDonation = {
            id: (donationsData.donations.length + 1).toString(),
            ...req.body,
            donorId: req.user.id,
            donorName: req.user.username,
            donorType: req.user.type,
            claimed: false,
            claimedBy: null,
            claimedAt: null,
            createdAt: new Date().toISOString()
        };

        donationsData.donations.push(newDonation);
        await writeJsonFile(DONATIONS_FILE, donationsData);

        // Find NGOs in the same area
        const nearbyNgos = usersData.users.filter(user => 
            user.type === 'ngo' && 
            user.area.toLowerCase() === newDonation.area.toLowerCase()
        );

        // Send notifications to nearby NGOs
        for (const ngo of nearbyNgos) {
            const emailText = `
                New Food Donation Available in ${newDonation.area}
                
                Food Item: ${newDonation.foodItem}
                Quantity: ${newDonation.quantity}
                Location: ${newDonation.location}
                Best Before: ${new Date(newDonation.expiryTime).toLocaleString()}
                
                Please log in to the platform to claim this donation.
            `;

            await sendEmail(ngo.email, 'New Food Donation Available', emailText);
        }

        res.json({
            success: true,
            donation: newDonation
        });
    } catch (err) {
        console.error('Error creating donation:', err);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Updated claim donation endpoint
app.post('/api/donations/:id/claim', authenticateToken, async (req, res) => {
    if (req.user.type !== 'ngo') {
        return res.status(403).json({
            success: false,
            message: 'Only NGOs can claim donations'
        });
    }

    try {
        const donationsData = await readJsonFile(DONATIONS_FILE);
        const usersData = await readJsonFile(USERS_FILE);
        
        const donationIndex = donationsData.donations.findIndex(d => d.id === req.params.id);

        if (donationIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Donation not found'
            });
        }

        const donation = donationsData.donations[donationIndex];

        if (donation.donorId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'Cannot claim your own donation'
            });
        }

        if (donation.claimed) {
            return res.status(400).json({
                success: false,
                message: 'Donation already claimed'
            });
        }

        // Update donation status
        donationsData.donations[donationIndex] = {
            ...donation,
            claimed: true,
            claimedBy: req.user.username,
            claimedAt: new Date().toISOString()
        };

        await writeJsonFile(DONATIONS_FILE, donationsData);

        // Find donor details
        const donor = usersData.users.find(user => user.id === donation.donorId);
        
        if (donor) {
            // Send email notification to donor
            const emailText = `
                Your donation has been claimed!
                
                Donation Details:
                - Food Item: ${donation.foodItem}
                - Quantity: ${donation.quantity}
                
                Claimed by: ${req.user.username} (${req.user.organization})
                Time: ${new Date().toLocaleString()}
                
                Thank you for your contribution!
            `;

            await sendEmail(donor.email, 'Your Donation Has Been Claimed', emailText);

            // Send SMS if phone number exists
            if (donor.phone) {
                await sendSMS(
                    donor.phone,
                    `Your donation of ${donation.foodItem} has been claimed by ${req.user.organization}. Thank you for your contribution!`
                );
            }
        }

        res.json({
            success: true,
            donation: donationsData.donations[donationIndex]
        });
    } catch (err) {
        console.error('Error claiming donation:', err);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Updated NGO directory endpoint
app.get('/api/ngos', authenticateToken, async (req, res) => {
    try {
        const usersData = await readJsonFile(USERS_FILE);
        const ngos = usersData.users
            .filter(user => user.type === 'ngo')
            .map(({ password, ...ngoData }) => ngoData);
        
        res.json(ngos);
    } catch (err) {
        console.error('Error fetching NGO directory:', err);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});
// Get all donations endpoint
app.get('/api/donations', authenticateToken, async (req, res) => {
    try {
        const donationsData = await readJsonFile(DONATIONS_FILE);
        
        // If user is NGO, only show unclaimed donations in their area
        if (req.user.type === 'ngo') {
            const filteredDonations = donationsData.donations.filter(donation => 
                !donation.claimed && 
                donation.area.toLowerCase() === req.user.area.toLowerCase()
            );
            return res.json(filteredDonations);
        }
        
        // If user is donor, show all their donations
        if (req.user.type === 'donor') {
            const filteredDonations = donationsData.donations.filter(donation => 
                donation.donorId === req.user.id
            );
            return res.json(filteredDonations);
        }
        
        // For admin or other types, show all donations
        res.json(donationsData.donations);
    } catch (err) {
        console.error('Error fetching donations:', err);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});
  
  // Get statistics
  app.get('/api/stats', async (req, res) => {
    try {
      const [usersData, donationsData] = await Promise.all([
        readJsonFile(USERS_FILE),
        readJsonFile(DONATIONS_FILE)
      ]);
  
      const stats = {
        totalDonors: usersData.users.filter(u => u.type === 'donor').length,
        totalNGOs: usersData.users.filter(u => u.type === 'ngo').length,
        totalDonations: donationsData.donations.length,
        activeDonations: donationsData.donations.filter(d => !d.claimed).length
      };
  
      res.json(stats);
    } catch (err) {
      console.error('Error fetching statistics:', err);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  });
  
  // Contact form submission
  app.post('/api/contact', authenticateToken, async (req, res) => {
    try {
      const contactsData = await readJsonFile(CONTACTS_FILE);
      const newContact = {
        id: (contactsData.contacts.length + 1).toString(),
        ...req.body,
        createdAt: new Date().toISOString(),
        responded: false
      };
  
      contactsData.contacts.push(newContact);
      await writeJsonFile(CONTACTS_FILE, contactsData);
  
      res.json({
        success: true,
        message: 'Message sent successfully'
      });
    } catch (err) {
      console.error('Error submitting contact form:', err);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  });

// Helper functions
async function readJsonFile(filePath) {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
}

async function writeJsonFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    await testEmail(); // Call the test function here to send the test email
});