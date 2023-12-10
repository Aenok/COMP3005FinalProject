const { Pool } = require('pg');     // To connect to the database
const readline = require('readline');       // used for asynchronous user input
let user;

// connecting to the postgres database
const pool = new Pool({
    user: "postgres",
    host: "localhost",
    port: 5432,
    database:"FitnessAppDB"
});

startApp();

//-----------------------------------------DATABASE MANIPULATION FUNCTIONS-----------------------------------------

/* Function that handles logging in. It prompts the user for a username and password and checks the database to see if it can find those values in the table. If it can, it assigns
   the result to the "user" variable and returns true. If it cant it prompts the user again for valid credentials*/
async function logIn(table) {
    try {

        console.log("\nEnter your credentials to log in, or input 0 for both fields to return to the menu\n");

        let userName = await getUserInput("Username:");
        let password = await getUserInput("Password:")

        if(userName == 0 && password == 0) {
            return;
        }

        const findUserQuery = {
            text: `SELECT * FROM ${table} WHERE email=$1 AND password=$2`,
            values: [userName, password]
        };

        const results = await pool.query(findUserQuery);
        if(results.rowCount != 0) {
            user = results;
            return true;
        } else {
            console.log("\nThe credentials you've entered don't match any members in our system. Please try again.\n");
            return await logIn(table);
        }
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that searches the "table" for an attribute "attr" that equals a value "val"
async function findMember(table, attr, val) {
    try{
        const query = {
            text: `SELECT * FROM ${table} WHERE ${attr}=$1`,
            values: [val]
        }
        
        return await pool.query(query);

    } catch (error) {
        console.error("Error executing query: ", error);
    }
}


async function findMember2(table, attr1, val1, attr2, val2) {
    try {
        const query = {
            text: `SELECT * FROM ${table} WHERE ${attr1}=$1 AND ${attr2}=$2`,
            values: [val1, val2]
        }
        let res = await pool.query(query);
        return res;
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}


// Function that finds all available classes specifically for members. This means no classes without trainers are presented
async function findAvailableClasses() {
    try {
        const cQuery = {
            text: 'SELECT * FROM Classes WHERE s_id IS NOT NULL'    // Checks for s_id NOT NULL, meaning that a trainer has been assigned
        }

        return await pool.query(cQuery);
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that finds all classes that the member in question is registered for. 
async function findRegisteredClasses() {
    try {
        const rcQuery = {
            text: `SELECT registered.c_id, class_name, room_number, date, staff.f_name || ' ' || staff.l_name AS Trainer FROM registered JOIN classes 
                                                                        ON registered.c_id = classes.c_id JOIN staff ON classes.s_id = staff.s_id WHERE m_id=$1`,
            values: [user.rows[0].m_id]
        };

        let res = await pool.query(rcQuery);
        return res;
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that finds all available trainers for a member to booking 1-on-1 training with
async function findAllTrainers() {
    try {
        const tQuery = {
            text: `SELECT s_id, f_name || ' ' || l_name AS Name FROM staff WHERE type=$1`,
            values: ['Trainer']
        }
        let res = await pool.query(tQuery);
        return res;
    } catch (error) {
        console.error("Error executing query: ", error);
    }


}

/* Function that takes a table argument and returns all the that table. Special cases exist for specific functions - i.e if the table is 'training', then it returns all 
    training sessions for the member calling it and presents the table with more data about the trainer in question. If the table is 'classes', then this function is being
    used by an admin staff member and wants to see all classes that are available, but may not have assigned trainers. Otherwise it just returns all rows from the table*/
async function findAllRows(table) {
    try {

        let queryText;

        if(table == 'training') {
            queryText = `SELECT t_id, ${table}.s_id, staff.f_name || ' ' || staff.l_name AS trainer, ${table}.m_id, member.f_name || ' ' || member.l_name AS trainee, t_date, comments
                                    FROM ${table} JOIN staff ON ${table}.s_id = staff.s_id JOIN member ON ${table}.m_id = member.m_id`
        } else if (table == 'classes') {
            queryText = `SELECT c_id, class_name, room_number, date, classes.s_id, f_name || ' ' || l_name AS Instructor FROM ${table} LEFT OUTER JOIN staff ON ${table}.s_id = staff.s_id ORDER BY c_id ASC`
        } else {
            queryText = `SELECT * FROM ${table}`;
        }

        const famQuery = {
            text: queryText
        };

        let res = await pool.query(famQuery);
        return res;
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that returns all scheduled trainings for the user with "id". An if statement handles whether "id" is a member_id or staff_id, and changes the query text accordingly
async function findScheduledTrainings(id) {
    try {

        let queryText;

        if(user.rows[0].m_id != undefined) {
            queryText = `SELECT t_id, m_id, f_name || ' ' || l_name AS Trainer, t_date AS Date, comments FROM training JOIN staff ON training.s_id = staff.s_id WHERE m_id=$1`;
        } else {
            queryText = `SELECT t_id, s_id, f_name || ' ' || l_name AS Member, t_date AS Date, comments FROM training JOIN member ON training.m_id = member.m_id WHERE s_id=$1`;
        }



        const stQuery = {
            text: queryText,
            values: [id]
        };


        let res = await pool.query(stQuery);
        return res;
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that handles the canceling of scheduled trainings for either members or trainers.
async function deleteScheduledTraining(t_id) {
    try {
        const dQuery = {
            text: 'DELETE FROM TRAINING WHERE t_id=$1',
            values: [t_id]
        }

        await pool.query(dQuery);
        console.log("\nTraining successfully cancelled.")
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

/* Function that handles registering either members or trainers. Members set themselves up, trainers need to be set up by someone with admin priveleges and through the admin
   dashboard. In both cases the user is prompted to enter in a firstname, lastname, email, and password. The function then checks the email to see if it already exists in the 
   table. If it does, the user must retry with a different email. Cases diverge here - if staff, the query is executed and the function returns. If member, then the newly created
   member_id is used to set up the member in the dependent tables "mem_goals" and "achievements"*/
async function registerUser(table) {
    try {

        let first_name;
        let last_name;
        let email_addr;
        let password;

        // If the user is registering to become a member
        if (table == 'member') {
            console.log("\nThank you for choosing to register with FitFusion! We just need a few things to get started:\n")
    
            first_name = await getUserInput("First Name:");
            last_name = await getUserInput("Last Name:");
            email_addr = await getUserInput("Email Address:");
            // Checking to see if the email address already exists in the database and thus is not usable
            while(await checkForEmail(email_addr)) {
                console.log("I'm sorry. That already exists in our database. Please use a different one");
                email_addr = await getUserInput("Email Address:");
            }
            password = await getUserInput("Password:");
    
            // Create query for new entry into Member table
            const regMemQuery = {
                text: `INSERT INTO ${table}(f_name, l_name, email, password) VALUES($1, $2, $3, $4)`,
                values: [first_name, last_name, email_addr, password]
            };
            await pool.query(regMemQuery);
            
            let newMem = await findMember(`${table}`, 'email', email_addr);     // To get a hold of the new member entry so that we can use their m_id attribute to register them in other tables
    
            // Create query for new entry into mem_goals table
            const regGoalQuery = {
                text: 'INSERT INTO Mem_Goals(m_id) VALUES($1)',
                values: [newMem.rows[0].m_id]
            };
    
            await pool.query(regGoalQuery);
    
            // Create query for new entry into achievements table
            const regAchQuery = {
                text: 'INSERT INTO Achievements(m_id) VALUES($1)',
                values: [newMem.rows[0].m_id]
            };
    
            await pool.query(regAchQuery);
    
            console.log("\nThank you for registering with us! Please log in.");

        // User is an admin staff member registering a new trainer in the database
        } else {

            console.log("Please enter the following to register a new trainer:")
            first_name = await getUserInput("First Name:");
            last_name = await getUserInput("Last Name:");
            email_addr = await getUserInput("Email Address:");
            while(await checkForEmail(email_addr)) {
                console.log("This email address is already registered in our system. Please use another one.");
                email_addr = await getUserInput("Email Address:");
            }
            password = await getUserInput("Password:");

            const regTrainerQuery = {
                text:`INSERT INTO ${table}(f_name, l_name, email, password, type) VALUES($1, $2, $3, $4, $5)`,
                values: [first_name, last_name, email_addr, password, 'Trainer']
            }

            await pool.query(regTrainerQuery);

            console.log("\nNew trainer successfully registered.");
        }
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function used to update a the attribute of a table to a specific value, where another attribute of the table already equals a specific value
async function updateAttr(table, attr1, val1, attr2, val2 ) {
    try {
        const updateQuery = {
            text: `UPDATE ${table} SET ${attr1}=$1 WHERE ${attr2}=$2`,
            values: [val1, val2]
        };

        

        await pool.query(updateQuery);
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function for trainers to view the relevant details of all members
async function trainerViewMembers() {
    try {
        const viewMemQuery = {
            text: `SELECT m_id, f_name, l_name, email, height, weight, gender FROM Member`,
        }

        return await pool.query(viewMemQuery);
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that is given a number and finds all e_id/e_name from the subquery table
async function findExerciseList(target) {
    try {
        const eListQuery = {
            text: `SELECT e_id, e_name FROM exercises WHERE e_area = (SELECT e_area FROM e_pointer WHERE e_id=$1)`,
            values: [target]
        };

        return await pool.query(eListQuery);
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that finds the names of exercises based on the target provided
async function findExerciseName(target) {
    try {
        const eQuery = {
            text: `SELECT e_name FROM exercises WHERE e_id=$1`,
            values: [target]
        };

        return await pool.query(eQuery);
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

/* Function that takes a series of arguments to register new activity in the 'mem_activity' table. First it finds the exervise name based on e_id to find the e_name. Then it inserts
    the values into the 'mem_activity' database. From there it also checks to see if the exercise being added in the new activity is part of the possible achievements. If it is
    then it compares their values to the currently entered values in the achievements table for this member. If they surpass those values, or if the values are null, the function
    updates the achievements table with the new values and informs the user of their improvement*/
async function registerActivty(m_id, e_id, dist, sets, reps, weight, date) {
    try {

        let res = await findExerciseName(e_id);

        const regActQuery = {
            text: 'INSERT INTO mem_activity(m_id, e_id, e_name, dist, sets, reps, weight_added, e_date) VALUES($1, $2, $3, $4, $5, $6, $7, $8)',
            values: [m_id, e_id, res.rows[0].e_name, dist, sets, reps, weight, date]
        };

        await pool.query(regActQuery);

        console.log("\nActivity added\n");

        // e_id 1 = cardio, e_id 6 = bench press, e_id 16 = squat, e_id 18 = deadlifts
        if(e_id == 1 || e_id == 6 || e_id == 16 || e_id == 18) {
            let check = await findMember('achievements', 'm_id', m_id);
            if(e_id == 1 && (check.rows[0].pr_cardio < dist || check.rows[0].pr_cardio == null)) {
                console.log("Congratulations! You surpassed your previous cardio achievement!")
                updateAttr("achievements", 'pr_cardio', dist, 'm_id', m_id);
            } else if (e_id == 6 && (check.rows[0].pr_bench < weight || check.rows[0].pr_bench == null)) {
                console.log("Congratulations! You surpassed your previous bench press achievement!")
                updateAttr("achievements", 'pr_bench', weight, 'm_id', m_id);
            } else if (e_id == 16 && (check.rows[0].pr_squat < weight || check.rows[0].pr_squat == null)) {
                console.log("Congratulations! You surpassed your previous squat achievement!")
                updateAttr("achievements", 'pr_squat', weight, 'm_id', m_id);
            } else if (e_id == 18 && (check.rows[0].pr_dl < weight || check.rows[0].pr_dl == null)) {
                console.log("Congratulations! You surpassed your previous dead lift achievement!")
                updateAttr("achievements", 'pr_dl', weight, 'm_id', m_id);
            }
        }

    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that allows a user to register for a class and updates the database accordingly based on the classes c_id and the member m_id
async function regForClass(c_id, m_id) {
    try{
        const regQuery = {
            text: `INSERT INTO Registered(c_id, m_id) VALUES ($1,$2)`,
            values: [c_id, m_id]
        };

        await pool.query(regQuery);

    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function used by both trainers and members. The function checks the id being passed to see if its one or the other and updates the query text accordingly.
async function regTrainingSession(id, date) {
    try {

        let queryValues;

        if(user.rows[0].m_id != undefined) {
            queryValues = [user.rows[0].m_id, id, date, ""]
        } else {
            queryValues = [id, user.rows[0].s_id, date, ""]
        }

        const rtsQuery = {
            text: `INSERT INTO training(m_id, s_id, t_date, comments) VALUES($1, $2, $3, $4)`,
            values: queryValues
        };

        await pool.query(rtsQuery);
        console.log("\nTraining session successfully registered.");
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function that allows the admin staff to manage the details of a class. It is used to change the room number, date, and trainer of the given class.
async function manageClassDetails(c_id, room_number, date, s_id) {
    try{
        const mcdQuery = {
            text: `UPDATE classes SET room_number=$1, date=$2, s_id=$3 WHERE c_id=$4`,
            values: [room_number, date, s_id, c_id]
        }

        await pool.query(mcdQuery);
        console.log("\nClass Successfully Updated!");
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

// Function used to process the payment of a given member. An admin will use this to charge their monthly fee of 25 dollars.
async function processPayment(member) {
    try {

         // Database value of acc_balance is of data type "MONEY", so the subtraction of 25$ needs to be cast to MONEY as well
        let val = `CAST('${member.acc_balance}' AS MONEY) - '25'::MONEY`;

        const gouge = {
            text: 'UPDATE member SET acc_balance = ' + val + ' WHERE m_id = $1',
            values: [member.m_id]
        };

        await pool.query(gouge);
    } catch (error) {
        console.error("Error executing query: ", error);
    }
}

//-----------------------------------------PROGRAM-SPECIFIC FUNCTIONS-----------------------------------------

// Starts the application and beings the series of many many many while loops acting a menus.
async function startApp() {

    // try to connect
    try {

        console.log("\n--------FITFUSION GYM----------");

        let initChoice = -1;
        let res = false;
        while(initChoice != 4) {
            await printInitalMenu();    // Prints inital menu showing what the user can choose.
            initChoice = await getUserInput(">");
            // If 1, member is logging in
            if(initChoice == 1) {
                res = await logIn('Member');
                if(res) {
                    await memberDashboard();
                }
            // If 2, staff is logging in
            } else if (initChoice == 2) {
                res = await logIn('Staff')
                if(res) {
                    await staffDashboard();
                }
            // If 3, user is attempting to join Fitfusion and register as a new member
            } else if (initChoice == 3) {
                await registerUser('member');
            // If 4, quit the program
            } else if (initChoice == 4) {
                await quit();             
            } else {
                console.log("\nThat was not an acceptable choice. Please try again.\n");
            }
        }

    } catch (error) {
        console.error('Error connecting to the database: ', error);
    }
}

// Function that manages the memberDashboard. Only ever executed whenever a member successfully logs in.
async function memberDashboard() {

    console.log(`\nHello ${user.rows[0].f_name} ${user.rows[0].l_name}`);

    let choice = -1;
    while(choice != 5) {
        console.log("\n--------MEMBER DASHBOARD---------");
        await printMembermenu();    // Prints the initial member menu options
        choice = await getUserInput(">");
        // If 1, member wants to manage their profile. Appropriate function is executed. 
        if(choice == 1) {
            await manageProfile();
        // If 2, member wants to manage their goals. Appropriate function is executed.            
        } else if (choice == 2) {
            await manageGoals();
        // If 3, member wants to view their achievements. Appropriate function is executed.    
        } else if (choice == 3) {
            await viewAchievements();
        // If 4, member wants to manage their activity at the gym. Appropriate function is executed.    
        } else if (choice == 4) {
            await manageActivity();
        // If 5, we return from this loop back to the initial menu.
        } else if(choice == 5) {
            return;
        } else {
            console.log("\nThat was not an acceptable choice. Please try again.\n");
        }
    }

}

// Function that manages the staffDashboard. A check is made to see if the staff is of admin level or trainer level and responds accordingly.
async function staffDashboard() {

    console.log(`\nHello ${user.rows[0].f_name} ${user.rows[0].l_name}`);
    
    let choice = -1;
    let res;
    let found;
    // If the staff that logged in is trainer
    if(user.rows[0].type == 'Trainer') {
        while(choice != 3) {

            console.log("\n--------TRAINER DASHBOARD---------");

            console.log("\nPlease select an option:\n");
            console.log("1. Manage Schedule");
            console.log("2. View Members");
            console.log("3. Log Out");
            choice = await getUserInput(">");
            // TRAINER DASHBOARD - Trainer wants to manage their schedule
            if(choice == 1) {
                let mChoice = -1;
                while(mChoice != 5) {

                    console.log("\n--------MANAGE SCHEDULE---------");
                    console.log("1. View Personal Training Schedule");
                    console.log("2. Schedule Training Session");
                    console.log("3. Cancel Training Session");
                    console.log("4. Input Comment");
                    console.log("5. Return");
                    
                    mChoice = await getUserInput(">");
                    // Trainer wants to see all past and future training sessions they have logged
                    if(mChoice == 1) {
                        console.log("\n--------PERSONAL TRAINING SCHEDULE---------");
                        res = await findScheduledTrainings(user.rows[0].s_id);
                        console.table(res.rows);

                    // Trainer wants to schedule a new training session
                    } else if (mChoice == 2) {
                        console.log("\n--------SCHEDULE TRAINING SESSION---------");
                        let m = await getUserInput("Please provide the id of the member you are scheduling for:");
                        let d = await getUserInput("Please provide the date of the session(YYYY-MM-DD):");
                        await regTrainingSession(m, d);

                    /* Trainer wants to cancel a training session. The trainer is prompted to enter in the id of the training session. A check is made to see if that 
                        training session actually exists. If it does, it is cancelled. If not, the trainer is informed and instructed to try again*/
                    } else if (mChoice == 3) {
                        console.log("\n--------CANCEL TRAINING SESSION---------\n");
                        let dChoice = await getUserInput("Please input the ID of the training session you wish to cancel:");
                        found = false;
                        res = await findScheduledTrainings(user.rows[0].s_id);
                        for(let i = 0; i < res.rowCount; i++) {
                            if(res.rows[i].t_id == dChoice) {
                             found = true;
                            }
                        }
                        if(found) {
                            await deleteScheduledTraining(dChoice);
                        } else {
                            console.log("\nThe number you have entered cannot be found in our training schedule. Please try again.");
                        }
                    /* Trainer wants to comment on a training session. They are prompted with a session id and prompted to enter a comment. A check is made to make sure the
                        training session actually exists. If it does, the comment is inputted. If not, the trainer is informed and isntructed to try again*/    
                    } else if (mChoice == 4) {
                        console.log("\n--------INPUT COMMENT---------");
                        let t = await getUserInput("Please input the ID of the training session you wish to access:")
                        let c = await getUserInput("Enter your comment:");
                        found = false;
                        res = await findScheduledTrainings(user.rows[0].s_id);
                        for(let i = 0; i < res.rowCount; i++) {
                            if(res.rows[i].t_id == t) {
                             found = true;
                            }
                        }
                        if(found) {
                            await updateAttr('training', 'comments', c, 't_id', t);
                        } else {
                            console.log("\nThe number you have entered cannot be found in our training schedule. Please try again.");
                        }
                    // Returns to the staff dashboard
                    } else if (mChoice == 5) {
                        break;
                    } else {
                        console.log("\nThat was not an acceptable choice. Please try again.\n");
                    }
                }
            // TRAINER DASHBOARD - Trainer wants to view members and appropriate details
            } else if (choice == 2) {
                res = await trainerViewMembers();
                console.table(res.rows);
            // TRAINER DASHBOARD - Trainer logs out
            } else if (choice == 3) {
                return;
            } else {
                console.log("\nThat was not an acceptable choice. Please try again.\n");
            }

        }
    // If the staff that logged in is an admin
    } else {
        while(choice != 5) {
            console.log("\n--------ADMIN DASHBOARD---------");

            console.log("\nPlease select an option:\n");
            console.log("1. View Gym Details");
            console.log("2. Class Management");
            console.log("3. Register Trainer");
            console.log("4. Process Membership Fees");
            console.log("5. Log Out");
            choice = await getUserInput(">");

            // ADMIN DASHBOARD - Admin wants to view gym details (View members, staff, & training schedule)
            if(choice == 1) {

                let vgChoice = -1;
                while(vgChoice != 4) {
                    console.log("\n--------VIEW GYM DETAILS---------\n");
                    console.log("1. View Members");
                    console.log("2. View Staff");
                    console.log("3. View Training Schedule");
                    console.log("4. Return");
                    vgChoice = await getUserInput(">");
                    // Admin queries all members of the "member" table and is shown all information. This is different than what trainers get, which has less info
                    if(vgChoice == 1) {
                        console.log("\n--------VIEW MEMBERS---------\n");
                        res = await findAllRows('member');
                        console.table(res.rows);
                    // Admin queries all members of the "staff" table and is shown the relevant information.
                    } else if (vgChoice == 2) {
                        console.log("\n--------VIEW STAFF---------\n");
                        res = await findAllRows('staff');
                        console.table(res.rows)
                    // Admin accesses the training table to view the schedules of all trainers
                    } else if (vgChoice == 3) {
                        console.log("\n--------VIEW TRAINING SCHEDULE---------\n");
                        res = await findAllRows('training');
                        console.table(res.rows)
                    // Admin returns to the admin dashboard
                    } else if (vgChoice == 4) {
                        break;
                    } else {
                        console.log("\nThat was not an acceptable choice. Please try again.\n");
                    }
                }
            // ADMIN DASHBOARD - Admin can view and manage classes here
            } else if(choice == 2) {

                let cmChoice = -1;
                while(cmChoice != 3) {
                    console.log("\n--------CLASS MANAGEMENT---------\n");
                    console.log("1. View Classes");
                    console.log("2. Manage Classes");
                    console.log("3. Return");
                    cmChoice = await getUserInput(">");
                    // Admin queries and views all available classes regardless of if a trainer has been scheduled. This allows them to know what classes still need assignment
                    if(cmChoice == 1) {
                        console.log("\n--------VIEW CLASSES---------\n");
                        res = await findAllRows('classes');
                        console.table(res.rows);
                    // Admin is prompted with a series of questions asking them to input relevant information for classes. Checks are made to make sure they are valid.
                    } else if (cmChoice == 2) {
                        console.log("\n--------MANAGE CLASSES---------\n");
                        let c = await getUserInput("Please enter the class id you are managing:");  // c_id of the class needing managing
                        res = await findAllRows("classes");
                        for(let i = 0; i < res.rowCount; i++) {
                            if(res.rows[i].c_id == c) {
                                found = true;
                            }
                        }
                        if (!found) {
                            console.log("That is not an acceptable class id choice. Please try again.")
                            continue;
                        }
                        let r = await getUserInput("If you would like to assign a room number to a class, please enter it:");   // room assignment
                        if(r == "") {
                            if(res.rows[c-1].room_number == null) {
                                r = null;
                            } else {
                                r= res.rows[c-1].room_number;
                            }
                        }
                        let d = await getUserInput("If you would like to schedule a date for a class, please enter it (YYYY-MM-DD):");  // date assignment
                        if(d == ""){
                            if(res.rows[c-1].date == null) {
                                d = null;
                            } else {
                                d = res.rows[c-1].date;
                            }
                        }

                        let s = await getUserInput("If you would like to assign a trainer to a class, please enter the trainers id:");  // Trainer assignment
                        if(s == ""){
                            if(res.rows[c-1].s_id == null) {
                                s = null;
                            } else {
                                s = res.rows[c-1].s_id;
                            }
                        }
                        await manageClassDetails(c, r, d, s);
                    // Returns to admin dashboard    
                    } else if (cmChoice == 3) {
                        break;
                    } else {
                        console.log("\nThat was not an acceptable choice. Please try again.\n");
                    }
                }
            // ADMIN DASHBOARD - Registering a new trainer
            } else if (choice == 3) {
                console.log("\n--------REGISTER TRAINER---------\n");
                await registerUser('staff')
            /* ADMIN DASHBOARD - Admin processes the 25$ monthly fee of all members. First all rows are found from the "member" table, then through a for loop, the "processPayment"
               function is called on all members found */
            } else if (choice == 4) {
                console.log("\n--------PROCESS MEMBERSHIP FEES---------\n");
                res = await findAllRows('member');
                console.log("Processing payments...")
                for(let i = 0; i < res.rowCount; i++) {
                    await processPayment(res.rows[i])
                }
                console.log("Members successfully gouged!");
            // Admin Logs out
            } else if (choice == 5) {
                return;
            } else {
                console.log("\nThat was not an acceptable choice. Please try again.\n");
            }
        }
    }

    return;

}

// Function that allows the member to manage their profile.
async function manageProfile() {

    let profChoice = -1;
    while (profChoice != 4) {

        console.log("\n--------MANAGE PROFILE---------\n");

        console.log("\nPlease select an option:\n");
        console.log("1. View Profile");
        console.log("2. Edit Profile");
        console.log("3. Check Account Balance");
        console.log("4. Return");

        profChoice = await getUserInput(">");
        /* MANAGE PROFILE - Member wants to view their profile. We check each attribute in the profile for null values and output an empty string if found. Otherwise, the value is
                            outputed*/
        if(profChoice == 1) {
            console.log("\n--------VIEW PROFILE---------\n");
            console.log(`MemberID: ${user.rows[0].m_id}\nName: ${user.rows[0].f_name} ${user.rows[0].l_name}\nEmail: ${user.rows[0].email}`); 
            let h = user.rows[0].height == null ? "Height:" : `Height: ${user.rows[0].height}cm`;
            console.log(h);
            let w = user.rows[0].weight == null ? "Weight:" : `Weight: ${user.rows[0].weight}lbs`;
            console.log(w);
            let g = user.rows[0].gender == null ? "Gender:" : `Gender: ${user.rows[0].gender}`;
            console.log(g);

        // MANAGE PROFILE - Member can adit their profile here through a submenu. Each number corresponds to a part of their profile that they can change.
        } else if (profChoice == 2) {
            let eChoice = -1;
            let change;
            console.log("\n--------EDIT PROFILE---------\n");
            while(eChoice != 7) {
                console.log("\nWhat would you like to edit?\n");
                console.log("1. First Name");
                console.log("2. Last Name");
                console.log("3. Email");
                console.log("4. Height");
                console.log("5. Weight");
                console.log("6. Gender");
                console.log("7. Return");

                eChoice = await getUserInput(">");
                // Checks to see if the value is 7, in which case no change is required, and the loop breaks out, returning the user to the MANAGE PROFILE menu
                if(eChoice == 7) {
                    break;
                }
                // Prompts the user as to what they would like to change their selection to
                console.log("What would you like to change it to?");
                change = await getUserInput(">");

                // 4 (height) and 5(weight) must be integers. This checks to make sure that they are, and prompts the user to enter in a valid value if they are not.
                while((eChoice == 4 || eChoice == 5) && (isNaN(parseInt(change)))) {
                    console.log("\nThe value you've entered is not acceptable. Please enter in a number for the value of the change.");
                    change = await getUserInput(">");
                }

                // Updates the attribute based on what value was chosen to be changed.
                if(eChoice == 1) {
                    await updateAttr('Member', 'f_name', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 2) {
                    await updateAttr('Member', 'l_name', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 3) {
                    await updateAttr('Member', 'email', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 4) {
                    await updateAttr('Member', 'height', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 5) {
                    await updateAttr('Member', 'weight', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 6) {
                    await updateAttr('Member', 'gender', change, 'm_id', user.rows[0].m_id);
                } else {
                    console.log("\nThat was not an acceptable choice. Please try again.\n");
                }
                // Resets the user value to the new specifications of the member
                user = await findMember('Member', 'm_id', user.rows[0].m_id);
            }
        // MANAGE PROFILE - Checks the balance of the logged in member
        } else if (profChoice == 3) {
            console.log("\n--------CHECK BALANCE---------");
            console.log(`\nAccount Balance: ${user.rows[0].acc_balance}`);
        // Returns to MEMBER DASHBOARD
        } else if(profChoice == 4){
            return;
        } else {
            console.log("\nThat was not an acceptable choice. Please try again.\n");
        }
    }
}

// Function that allows the user to manage their goals
async function manageGoals() {

    let choice = -1;
    while(choice != 3) {

        console.log("\n--------MANAGE GOALS---------\n");

        console.log("\nPlease select an option:\n");
        console.log("1. View Goals");
        console.log("2. Edit Goals");
        console.log("3. Return");

        choice = await getUserInput(">");

        // MANAGE GOALS - Member can view their goals here. Output is properly formatted to exclude null values.
        if(choice == 1) {
            console.log("\n--------VIEW GOALS---------\n");
            let results = await findMember('mem_goals', 'm_id', user.rows[0].m_id);
            let w = (results.rows[0].t_weight == null) ? `Target Weight:` : `Target Weight: ${results.rows[0].t_weight}lbs`;
            console.log(w);
            let c = (results.rows[0].t_cardio == null) ? `Target Distance Run:` : `Target Distance Run: ${results.rows[0].t_cardio}KM`;
            console.log(c);
            let b = (results.rows[0].t_bench == null) ? `Target Bench Press:` : `Target Bench Press: ${results.rows[0].t_bench}lbs`;
            console.log(b);
            let s = (results.rows[0].t_squat == null) ? `Target Squat:` : `Target Squat: ${results.rows[0].t_squat}lbs`;
            console.log(s);
            let d = (results.rows[0].t_dl == null) ? `Target Dead Lift:` : `Target Dead Lift: ${results.rows[0].t_dl}lbs`;
            console.log(d);

        // MANAGE GOALS - Member can choose goals to edit and make the changes here
        } else if (choice == 2) {
            let eChoice = -1;
            let change;
            console.log("\n--------EDIT GOALS---------\n");
            while(eChoice != 6) {

                console.log("\nWhat would you like to edit?\n");
                console.log("1. Target Weight");
                console.log("2. Target Distance Run");
                console.log("3. Target Bench Press");
                console.log("4. Target Squat");
                console.log("5. Target Dead Lift");
                console.log("6. Return");

                eChoice = await getUserInput(">");

                // Breaks out of the loop, returning to MANAGE GOALS if 6 is chosen
                if(eChoice == 6) {
                    break;
                }

                // Prompts the change
                console.log("What would you like to change it to?");
                change = await getUserInput(">");

                // Checks to make sure that the value is an integer, as all goals must be INT
                while(isNaN(parseInt(change))) {
                    console.log("\nThe value you've entered is not acceptable. Please enter in a number for the value of the change.");
                    change = await getUserInput(">");
                }
                
                // Updates the appropriate goals with the entered change
                if(eChoice == 1) {
                    await updateAttr('mem_goals', 't_weight', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 2) {
                    await updateAttr('mem_goals', 't_cardio', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 3) {
                    await updateAttr('mem_goals', 't_bench', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 4) {
                    await updateAttr('mem_goals', 't_squat', change, 'm_id', user.rows[0].m_id);
                } else if (eChoice == 5) {
                    await updateAttr('mem_goals', 't_dl', change, 'm_id', user.rows[0].m_id);
                } else {
                    console.log("\nThat was not an acceptable choice. Please try again.\n");
                }
            }
        // Returns to MEMBER DASHBOARD
        } else if (choice == 3) {
            return;
        } else {
            console.log("\nThat was not an acceptable choice. Please try again.\n");
        }
    }
}

// Function that formats and prints out the results of the member achievements, excluding all null values.
async function viewAchievements() {

    console.log("\n--------ACHIEVEMENTS---------\n");
    let results = await findMember('Achievements', 'm_id', user.rows[0].m_id);

    let w = (results.rows[0].pr_weight == null) ? `PR Weight:` : `PR Weight: ${results.rows[0].pr_weight}lbs`;
    console.log(w);
    let c = (results.rows[0].pr_cardio == null) ? `PR Distance Run:` : `PR Distance Run: ${results.rows[0].pr_cardio}KM`;
    console.log(c);
    let b = (results.rows[0].pr_bench == null) ? `PR Bench Press:` : `PR Bench Press: ${results.rows[0].pr_bench}lbs`;
    console.log(b);
    let s = (results.rows[0].pr_squat == null) ? `PR Squat:` : `PR Squat: ${results.rows[0].pr_squat}lbs`;
    console.log(s);
    let d = (results.rows[0].pr_dl == null) ? `PR Dead Lift:` : `PR Dead Lift: ${results.rows[0].pr_dl}lbs`;
    console.log(d);  

}

// Function that allows the member to manage their gym activity.
async function manageActivity() {

    let choice = -1;
    let  res;
    while(choice != 6) {

        console.log("\n--------MANAGE ACTIVITY---------");

        console.log("\nPlease select an option:\n");
        console.log("1. View Gym Exercises");
        console.log("2. View Personal Activity");
        console.log("3. Record Personal Activity");
        console.log("4. Gym Classes");
        console.log("5. 1-on-1 Personal Training");
        console.log("6. Return");        

        choice = await getUserInput(">");

        // MANAGE ACTIVITY - Allows member to view all available exercises that can be recorded in the application
        if(choice == 1) {

            let eChoice = -1;
            
            while(eChoice != 9) {

                console.log("\n--------VIEW EXERCISES---------\n");

                console.log("\nEnter in the area of exercise you are searching for, or enter 9 to return to previous menu:\n");
                console.log("1. Cardio");
                console.log("2. Chest");
                console.log("3. Back");
                console.log("4. Legs");
                console.log("5. Shoulders");
                console.log("6. Biceps");  
                console.log("7. Triceps");  
                console.log("8. Core");  
                console.log("9. Return");

                eChoice = await getUserInput(">");

                // If 9, breaks out of the loop
                if(eChoice == 9) {
                    break;
                // Checks to make sure the choice is within the proper bounds                    
                } else if (eChoice < 1 || eChoice > 9) {
                    console.log("\nThat was not an acceptable choice. Please try again.\n");
                // Finds the exercise list based on the validated choice
                } else {
                    res = await findExerciseList(eChoice);
                    console.log("\n-------------------------------\n");
                    console.table(res.rows);
                }
            }
        
        // MANAGE ACTIVITY - Allows member to view their personal recorded gym activity
        } else if (choice == 2) {
            
            console.log("\n--------PERSONAL ACTIVITY---------\n");
            res = await findMember('mem_activity', 'm_id', user.rows[0].m_id)
            console.table(res.rows);
        
        // MANAGE ACTIVITY - Allows the member to record a new exercise to their logs
        } else if (choice == 3) {
            console.log("\n--------RECORDING PERSONAL ACTIVITY---------\n");
                        
            console.log("Please provide the following information (Enter nothing if not applicable):");
            let e = await getUserInput("Exercise ID");
            let dist = await getUserInput("Distance Travelled:");
            if(dist === "") {
                dist = null;
            }

            let s = await getUserInput("Sets:");
            if(s === "") {
                s = null;
            }

            let r = await getUserInput("Reps:")
            if(r === "") {
                r = null;
            }
            let w = await getUserInput("Weight lifted:")
            if(w === "") {
                w = null;
            }
            let date = await getUserInput("Date of exercise (YYYY-MM-DD)");

            if(e != "") {
                await registerActivty(user.rows[0].m_id, e, dist, s, r, w, date);
            }

        // MANAGE ACTIVITY - Allows the user to view offered gym classes, view all classes that they have registered to, and register for other gym classes
        } else if (choice == 4) {

            let rChoice = -1;
            let res;

            while(rChoice != 4) {
                console.log("\n--------GYM CLASSES---------");

                console.log("\nPlease select an option:\n");
                console.log("1. View Offered Classes");
                console.log("2. View Registered Classes");
                console.log("3. Register For Class");
                console.log("4. Return");

                rChoice = await getUserInput(">");

                // Provides all available gym classes. This returns the classes that already have a trainer assigned to them.
                if(rChoice == 1) {
                    res = await findAvailableClasses();
                    console.table(res.rows);
                
                // Provides all classes that the member has registered for - past and future
                } else if (rChoice == 2) {
                    res = await findRegisteredClasses();
                    console.table(res.rows)
                
                /* Allows the member to choose a class to register for. The available classes are searched for, and the c_id entered by the member is compared to see if it is in the 
                    list. If it is, then the member is registered for the class. if it isnt, the member is informed that the id they entered is not available. */
                } else if (rChoice == 3) {
                    let cChoice = await getUserInput("Enter the course ID you would like to register for:");
                    res = await findAvailableClasses();
                    let avail = false;
                    for(let i = 0; i < res.rowCount; i++) {
                        if(res.rows[i].c_id == cChoice){
                            avail = true;
                        }
                    }

                    res = await findMember2('registered', 'c_id', cChoice, 'm_id', user.rows[0].m_id);
                    if(res.rowCount > 0) {
                        console.log("\nYou have already registered for this course.");
                        continue;
                    }

                    if(avail) {
                        await regForClass(cChoice, user.rows[0].m_id);
                    } else {
                        console.log("Im sorry. The course you selected is not available.");
                    }
                // Breaks out of the loop and returns to MANAGE ACTIVITY
                } else if (rChoice == 4) {
                    break;
                } else {
                    console.log("\nThat was not an acceptable choice. Please try again.\n");
                }
            }
        // MANAGE ACTIVITY - Allows the member manage 1-on-1 personal training
        } else if (choice == 5) {
            
            let tChoice = -1;
            let res;
            while(tChoice != 5) {
                console.log("\n--------1-ON-1 PERSONAL TRAINING---------\n");

                console.log("\nPlease select an option:\n");
                console.log("1. View Available Trainers");
                console.log("2. View Scheduled Trainings");
                console.log("3. Delete Scheduled Training");
                console.log("4. Register For Training");
                console.log("5. Return");
                tChoice = await getUserInput(">");

                // Shows all trainers available to schedule with
                if(tChoice == 1) {
                    console.log("\n--------TRAINERS---------\n");
                    res = await findAllTrainers();
                    console.table(res.rows);

                // Shows all scheduled trainings
                } else if(tChoice == 2){
                    console.log("\n--------SCHEDULED TRAININGS---------\n");
                    res = await findScheduledTrainings(user.rows[0].m_id);
                    console.table(res.rows)
                
                // Allows a member to cancel their training
                }else if(tChoice == 3){
                    console.log("\n--------CANCEL TRAINING---------\n");
                    let dChoice = await getUserInput("Please input the ID of the training session you wish to cancel:");
                    let found = false;
                    res = await findScheduledTrainings(user.rows[0].m_id);
                    for(let i = 0; i < res.rowCount; i++) {
                        if(res.rows[i].t_id == dChoice) {
                            found = true;
                        }
                    }
                    if(found) {
                        await deleteScheduledTraining(dChoice);
                    } else {
                        console.log("\nThe number you have entered cannot be found in our training schedule. Please try again.");
                    }
                
                // Allows a member to register for training
                }else if(tChoice == 4){
                    console.log("\n--------REGISTER TRAINING---------\n");
                    let s = await getUserInput("Please enter the id of the trainer you would like to schedule a session with:");
                    let d = await getUserInput("Please enter the date you'd like to train on (YYYY-MM-DD):");
                    await regTrainingSession(s, d);
                
                // Breaks out of the loop, returning to MANAGE ACTIVITY
                }else if(tChoice == 5){
                    break;
                } else {
                    console.log("\nThat was not an acceptable choice. Please try again.\n");
                }


            }
        
        // Returns to MEMBER DASHBOARD
        } else if (choice == 6) {
            return;
        } else {
            console.log("\nThat was not an acceptable choice. Please try again.\n");
        }
    }

}

// Helper function that prints out the menu
async function printInitalMenu() {
    console.log("\nWelcome to the FitFusion Fitness App! Please choose from the following:\n");
    console.log("1. Member Log In");
    console.log("2. Staff Log In");
    console.log("3. Register New Member");
    console.log("4. Quit");
}

// Helper function that prints out member menu
async function printMembermenu() {
    console.log("\nPlease select what you'd like to do:\n");
    console.log("1. Manage Profile");
    console.log("2. Manage Goals");
    console.log("3. View Achievements");
    console.log("4. Manage Gym Activity");
    console.log("5. Log Out");
}

async function checkForEmail(e) {
    const checkQuery = {
        text: 'SELECT * FROM Member WHERE email=$1',
        values: [e]
    }

    const results = await pool.query(checkQuery);
    return (results.rowCount == 1);
}

async function quit() {
    console.log("\nFrom all of us at FitFusion, thank you for using our stoneage era fitness app.\nGoodbye!\n");
    process.exit(0);   
}

// Helper function that takes a promptText as an argument and creates a readline interface. From there a promise is returned with what the user chooses
async function getUserInput(promptText) {

    const r1 = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        r1.question(promptText + ' ', (answer) => {
            r1.close();
            resolve(answer);
        })
    })
}
